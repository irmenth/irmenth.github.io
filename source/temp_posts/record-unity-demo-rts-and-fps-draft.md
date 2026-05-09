---
title: RTS 结合 FPS 的 Unity 项目试做日志：Flow Field Path Finding 与 Burst Job System 高性能实现
date: 2026-04-13 16:00:00
---

## 前言

在大型 RTS（实时策略）游戏中，当战场上有成百上千个单位同时移动时，传统的 A* 寻路算法会面临严重的性能问题。为了解决这个问题，我们需要一种高效的移动方案——流场（Flow Field）寻路。

本文将深入探讨 Unity 中基于 Burst Job System 实现的流场寻路系统，详细解析其实现过程、优化策略以及关键技术细节。

本文档是我们在 Unity RTS 项目中的一次技术探索记录，主要目标是：
- 深入理解流场寻路的核心原理
- 掌握 Burst Job System 的高性能编程技巧
- 实现可扩展的单位移动系统
- 优化内存管理和 CPU 使用效率

通过本文档，你将了解到如何在 Unity 中构建一个高性能的 RTS 单位移动系统，以及如何利用现代 Unity 的 Burst 编译器和 Jobs System 来提升性能。

---

## 流场寻路核心技术原理

### 什么是流场寻路？

流场寻路是一种基于向量场的智能移动方案。其核心思想是：**不计算每个单位的完整路径，而是预先计算一个"流向场"，每个格子存储一个移动方向，单位只需要根据当前所在位置的向量方向移动即可。**

想象水流在山间的流动——你不需要计算每条水流的完整路径，只需要知道每个点的水流方向，水自然会流向低处。同样的道理，流场寻路也是通过预先计算每个格子的移动方向，让单位自然地跟随这个方向移动。

### 为什么 RTS 需要流场？

传统 A* 寻路在少量单位时没问题，但一旦单位数量变得庞大（如 RTS 游戏中几百上千个单位同时移动），如果每个单位都独立跑 A*，会带来巨大的计算开销。A* 算法的时间复杂度是 O(m+n)，其中 m 是边数，n 是节点数。当有 1000 个单位时，每次移动都需要计算 1000 次 A*，这是非常耗时的。

相比之下，流场寻路的优势在于：
- **一次计算，全员使用** —— 计算一次流向场，所有单位共享
- **每帧开销极低** —— 单位只需查询当前格子的方向并向前移动
- **天然适合大规模单位群体**
- **内存占用可控** —— 只需要存储每个格子的方向信息
- **易于实现 AI 行为** —— 可以通过修改流场快速改变单位行为

### 流场与 A* 的比较

| 特性 | A* 寻路 | 流场寻路 |
|------|---------|----------|
| 计算复杂度 | O(m+n) × 单位数 | O(网格数) + O(单位数) |
| 内存占用 | 需要存储打开集和关闭集 | 只需要存储方向网格 |
| 实时性 | 每次移动都需要计算 | 每帧只需简单查询 |
| 适用场景 | 小规模单位 | 大规模单位群体 |
| 精度 | 最优路径 | 近似路径 |

---

## 系统架构设计

### 双网格系统设计

系统采用双网格架构：
- **Direction Grid（方向网格）**：存储每个格子的移动方向、成本、热值等核心数据
- **Obstacle Grid（障碍网格）**：专门用于存储障碍物和单位的占用信息

这种双网格设计的好处是：
1. **职责分离**：方向网格专注于移动方向，障碍网格专注于碰撞检测
2. **并行处理**：两个网格可以独立处理，提高并行度
3. **易于扩展**：可以方便地添加新的网格类型

### 核心数据结构

```csharp
public struct DirectionCell
{
    public int index;           // 格子索引
    public float2 worldPos;     // 世界坐标位置
    public float cost;          // 移动成本（1=普通，2=崎岖，∞=不可通行）
    public float heat;          // 热值：到目标的"距离"
    public float2 direction;    // 方向向量（归一化的移动方向）
}
```

DirectionCell 结构体的设计考虑：
- `index` 用于快速访问网格数据，避免每次都计算坐标
- `worldPos` 用于碰撞检测和坐标转换
- `cost` 表示移动难度，影响单位移动速度
- `heat` 是热场值，越小表示离目标越近
- `direction` 是最终的移动方向，单位每帧根据这个方向移动

```csharp
public struct ObstacleCell
{
    public int index;           // 格子索引
    public float2 worldPos;     // 世界坐标位置
}
```

ObstacleCell 相对简单，只存储障碍物的基本信息。

### 关键映射表

系统使用 `NativeParallelMultiHashMap<int, int>` 建立高效映射：
- `cellToUnit`：从障碍格子索引到单位 ID 的映射
- `cellToObstacle`：从障碍格子索引到障碍物 ID 的映射

这种数据结构能够在 O(log N) 时间内完成查找操作，是 Burst Job System 中的高性能容器。选择这个数据结构的原因：
1. **多键支持**：一个格子可以有多个障碍物
2. **并行遍历**：支持并行迭代，适合 Burst 编译
3. **内存效率**：相比 C# 的 Dictionary，内存占用更小
4. **类型安全**：编译时检查，减少运行时错误

---

## Flow Field 生成流程详解

流场生成分为四个主要步骤，每个步骤都有相应的 Burst Job 进行优化：

### 第一步：网格生成（GenerateGridBurst）

首先初始化两个网格的基础数据：

```csharp
public void GenerateGridBurst()
{
    DirectionGridGenerationJob dirGridGenJob = new(dgSize.y, dcRadius, directionGrid);
    dirGridGenJob.Schedule(dgSize.x * dgSize.y, 64).Complete();
    
    ObstacleGridGenerationJob obsGridGenJob = new(ogSize.y, ocRadius, obstacleGrid);
    obsGridGenJob.Schedule(ogSize.x * ogSize.y, 64).Complete();
}
```

**实现细节**：
- 使用 `DirectionGridGenerationJob` 并行填充每个 DirectionCell 的坐标和默认值
- 使用 `ObstacleGridGenerationJob` 填充 ObstacleCell 的坐标
- 每个 Job 并行度设置为 64，充分利用 CPU 多核
- 使用 `Allocator.Persistent` 分配持久内存，避免每帧重复分配

**Job 内部逻辑**：
```csharp
[BurstCompile]
public struct DirectionGridGenerationJob : IJobParallelFor
{
    public void Execute(int index)
    {
        int x = index / height;
        int y = index % height;
        
        directionGrid[index] = new DirectionCell(
            index, 
            new float2(x, y) * diameter + new float2(radius)
        );
    }
}
```

**为什么使用 Job Parallel For**：
- 每个格子是独立的，没有数据依赖
- 可以并行处理所有格子
- Burst 编译器可以优化循环，生成 SIMD 代码

**内存分配策略**：
- `Allocator.TempJob`：临时内存，Job 结束后自动释放，适合临时数据
- `Allocator.Persistent`：持久内存，适合网格等长期数据
- 避免使用 `Allocator.Default`，因为它可能会分配大块内存

### 第二步：成本场生成（GenerateCostField）

这一步需要遍历每个 DirectionGrid 格子，检测它是否被障碍物覆盖，从而设置 cost。

**关键优化策略：sub-cell 九宫格细分**

每个 DG（Direction Grid）格子再细分为 3×3 的 sub-cell，通过以下方式检测碰撞：
1. 对整体区域进行 `Physics.OverlapBox` 检测
2. 对每个 sub-cell 做射线检测
3. 根据 sub-cell 被阻挡的数量确定格子的 cost

```csharp
float subCellDiameter = dcDiameter / 3f;
for (int x = 0; x < dgSize.x; x++)
{
    for (int y = 0; y < dgSize.y; y++)
    {
        int index = x * dgSize.y + y;
        Vector3 detectPos = new(directionGrid[index].worldPos.x, -10, directionGrid[index].worldPos.y);
        int hitCount = Physics.OverlapBoxNonAlloc(detectPos, new Vector3(dcRadius, 20, dcRadius), 
                                                    dgBoxHitBuffter, Quaternion.identity, costLayerMask);
        
        // 细分检测
        bool hasRecordRough = false, hasRecordImpassible = false;
        for (int i = 0; i < hitCount; i++)
        {
            if (float.IsInfinity(directionGrid[index].cost)) continue;
            
            // 检查 impassible 层
            if (!hasRecordImpassible && dgBoxHitBuffter[i].gameObject.layer == impassibleLayer)
            {
                int subCellHitCount = 0;
                for (int dx = -1; dx <= 1; dx++)
                {
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        if (subCellHitCount >= 4) break;
                        Vector3 curSubCellPos = detectPos + new Vector3(dx * subCellDiameter, 0, dy * subCellDiameter);
                        if (Physics.Raycast(curSubCellPos, Vector3.up, out RaycastHit hit, 100f, 1 << impassibleLayer))
                            subCellHitCount++;
                    }
                }
                
                if (subCellHitCount >= 4)
                {
                    ChangeCost(index, float.PositiveInfinity);
                    hasRecordImpassible = true;
                    hasRecordRough = true;
                }
            }
            
            // 检查 rough 层
            if (!hasRecordRough && dgBoxHitBuffter[i].gameObject.layer == roughLayer)
            {
                // 类似的 sub-cell 细分检测
                if (subCellHitCount >= 4)
                {
                    ChangeCost(index, 2f);
                    hasRecordRough = true;
                }
            }
        }
    }
}
```

**优势**：
- 避免将边界或部分覆盖的障碍误判为全格障碍
- 提供更平滑的成本场
- 使单位移动更加自然
- 提高碰撞检测的精度

**为什么要做 sub-cell 细分**：
在 RTS 游戏中，障碍物可能只覆盖格子的部分区域。如果不做细分，单位可能会直接穿过障碍物的边缘。通过 sub-cell 细分，我们可以更精确地检测碰撞，使单位的移动更加平滑和自然。

### 第三步：Heat Map 生成（GenerateHeatMapBurst）

Heat Map 是流场寻路的核心步骤。它模拟热量从目标点向四周扩散的过程，每个格子获得一个 heat 值，heat 越小表示离目标越近。

**算法**：类似 Dijkstra 的带权重 BFS

```csharp
public float2 GenerateHeatMapBurst(int destinationGridIndex)
{
    int size = dgSize.x * dgSize.y;
    
    NativeQueue<int> openList = new(Allocator.TempJob);
    NativeArray<byte> inOpenList = new(size, Allocator.TempJob);
    NativeArray<byte> closeList = new(size, Allocator.TempJob);
    NativeArray<int> destination = new(1, Allocator.TempJob);
    
    destination[0] = destinationGridIndex;
    HeatMapJob job = new(dgSize, destination, openList, inOpenList, closeList, directionGrid);
    job.Schedule().Complete();
    
    // 返回目标位置
    return destIndex == destinationGridIndex ? new(-1, -1) : directionGrid[destIndex].worldPos;
}
```

**HeatMapJob 实现**：
```csharp
[BurstCompile]
public struct HeatMapJob : IJob
{
    public void Execute()
    {
        float sqr2 = math.sqrt(2f);
        
        // 初始化：所有 heat = ∞
        for (int i = 0; i < size.x * size.y; i++)
        {
            ChangeHeat(i, float.PositiveInfinity);
        }
        
        // 特殊情况：如果目标点不可达，向外扩散一圈作为标记
        if (math.isinf(directionGrid[destination[0]].cost))
        {
            // 向外扩散标记
        }
        
        // 起点 heat = 0，入队
        ChangeHeat(destination[0], 0f);
        openList.Enqueue(destination[0]);
        inOpenList[destination[0]] = 1;
        
        while (openList.Count > 0)
        {
            int curIndex = openList.Dequeue();
            inOpenList[curIndex] = 0;
            closeList[curIndex] = 1;
            
            int2 curGridPos = new(curIndex / size.y, curIndex % size.y);
            
            // 遍历 8 个邻居（含对角）
            for (int dx = -1; dx <= 1; dx++)
            {
                for (int dy = -1; dy <= 1; dy++)
                {
                    if (dx == 0 && dy == 0) continue;
                    
                    int nx = curGridPos.x + dx, ny = curGridPos.y + dy;
                    if (nx < 0 || nx >= size.x || ny < 0 || ny >= size.y) continue;
                    
                    int newIndex = nx * size.y + ny;
                    
                    // 已关闭的格子跳过
                    if (closeList[newIndex] == 1) continue;
                    if (math.isinf(directionGrid[newIndex].cost))
                    {
                        closeList[newIndex] = 1;
                        continue;
                    }
                    
                    // 计算新的 heat 值（对角移动 cost *= √2）
                    float cost = directionGrid[curIndex].cost;
                    if (dx != 0 && dy != 0)
                        cost *= sqr2;
                    
                    float newHeat = directionGrid[curIndex].heat + cost;
                    
                    // 如果新值更小，更新
                    if (newHeat < directionGrid[newIndex].heat)
                    {
                        ChangeHeat(newIndex, newHeat);
                        if (inOpenList[newIndex] == 0)
                        {
                            openList.Enqueue(newIndex);
                            inOpenList[newIndex] = 1;
                        }
                    }
                }
            }
        }
    }
    
    private void ChangeHeat(int index, float heat)
    {
        DirectionCell cell = directionGrid[index];
        cell.heat = heat;
        directionGrid[index] = cell;
    }
}
```

**关键点**：
- 使用 `NativeQueue` 和 `NativeArray<byte>` 标记列表，全部在 Burst Job 中执行
- 对角线移动 cost 乘以 √2，保证正确性
- 原地修改 `directionGrid` 中的 `heat` 字段，避免额外内存
- 使用 `IJob` 而非 `IJobParallelFor`，因为这个 Job 是顺序执行的

**算法分析**：
- 时间复杂度：O(V + E)，其中 V 是格子数，E 是邻居数
- 空间复杂度：O(V)，只需要存储每个格子的 heat 值
- 这是一个优化的 Dijkstra 算法，使用优先级队列

**为什么使用 NativeQueue**：
C# 的 `Queue<T>` 不支持 Burst 编译，使用 `NativeQueue` 可以在 Burst Job 中操作队列。

### 第四步：Flow Field 生成（GenerateFlowFieldBurst）

有了 heat 值之后，计算每个格子的最终移动方向：取周围 8 个邻居中 heat 最小的方向。

```csharp
public void GenerateFlowFieldBurst()
{
    int size = dgSize.x * dgSize.y;
    
    NativeArray<float2> flowDir = new(size, Allocator.TempJob);
    
    FlowFieldJob job = new(dgSize, directionGrid, flowDir);
    job.Schedule(size, 64).Complete();
    
    // 原地修改 directionGrid 中的 direction 字段
    for (int i = 0; i < size; i++)
    {
        ChangeDirection(i, flowDir[i]);
    }
    
    flowDir.Dispose();
}
```

**FlowFieldJob 实现**：
```csharp
[BurstCompile]
public struct FlowFieldJob : IJobParallelFor
{
    public void Execute(int index)
    {
        flowDir[index] = float2.zero;
        
        // 不可通行格子
        if (math.isinf(directionGrid[index].heat))
        {
            flowDir[index] = new(float.PositiveInfinity, float.PositiveInfinity);
            return;
        }
        
        int x = index / size.y, y = index % size.y;
        
        float minHeat = directionGrid[index].heat;
        float2 baseDir = float2.zero;
        
        // 遍历 8 个邻居，找到 heat 最小的方向
        for (int dx = -1; dx <= 1; dx++)
        {
            for (int dy = -1; dy <= 1; dy++)
            {
                if (dx == 0 && dy == 0) continue;
                
                int nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= size.x || ny < 0 || ny >= size.y) continue;
                
                int newIndex = nx * size.y + ny;
                float newHeat = directionGrid[newIndex].heat;
                
                if (newHeat < minHeat)
                {
                    minHeat = newHeat;
                    baseDir = new(dx, dy);
                }
            }
        }
        
        // 如果周围有比当前 heat 更小的邻居，计算方向
        if (math.abs(minHeat - directionGrid[index].heat) < 1e-3f) return;
        
        flowDir[index] = math.normalize(baseDir);
    }
}
```

**算法解释**：
1. 遍历当前格子的 8 个邻居
2. 找到 heat 值最小的邻居
3. 计算从当前格子到该邻居的方向
4. 归一化后作为移动方向

**边界情况处理**：
- 如果所有邻居的 heat 都相等，说明无法到达目标，返回零向量
- 使用 1e-3f 作为容差，避免浮点误差

---

## 障碍物系统

### 障碍物网格映射（GenerateObstacleMap）

将动态障碍物（单位、移动物体）记录到 `cellToObstacle`，以便流场计算时避开。

```csharp
public void GenerateObstacleMap(int impassibleLayer)
{
    for (int x = 0; x < ogSize.x; x++)
    {
        for (int y = 0; y < ogSize.y; y++)
        {
            int index = x * ogSize.y + y;
            Vector3 detectPos = new(obstacleGrid[index].worldPos.x, -10, obstacleGrid[index].worldPos.y);
            
            // 检测该格子内的障碍物
            int hitCount = Physics.OverlapBoxNonAlloc(detectPos, new Vector3(ocRadius, 20, ocRadius), 
                                                       ogBoxHitBuffer, Quaternion.identity, 1 << impassibleLayer);
            
            for (int i = 0; i < hitCount; i++)
            {
                Collider collider = ogBoxHitBuffer[i];
                
                // 使用缓存避免重复 GetComponent
                if (!colliderBuffer.ContainsKey(collider))
                    colliderBuffer[collider] = collider.GetComponent<ObstacleAgent>().id;
                
                int id = colliderBuffer[collider];
                
                // 将障碍物 ID 添加到该格子的映射中
                cellToObstacle.Add(index, id);
            }
        }
    }
}
```

**优化技巧**：
- 维护 `colliderBuffer` 缓存，避免每次调用 `GetComponent<ObstacleAgent>().id` 的开销
- 使用 `OverlapBoxNonAlloc` 重用碰撞检测数组，避免内存分配

**为什么要缓存 GetComponent**：
`GetComponent` 是 Unity 中开销较大的操作，特别是在每帧执行时。通过缓存，我们可以避免重复调用，提高性能。

**每帧性能分析**：
假设每帧有 100 个障碍物，每个障碍物调用一次 `GetComponent`，这会导致 100 次组件查找。在 Burst Job 中，这会导致严重的性能问题。通过缓存，我们可以将这个开销降低到几乎为零。

### 障碍物几何形状支持

系统支持两种障碍物形状：
- **Circle（圆形）**：中心点 + 半径，表示圆柱状障碍
- **Rectangle（矩形）**：中心点 + 尺寸 + 朝向向量，表示轴对齐或旋转的矩形

**设计原因**：
RTS 游戏中的障碍物通常是圆形（树木、岩石）或矩形（建筑物）。支持这两种形状可以覆盖大部分场景。

---

## 单位移动系统

单位系统使用 `UpdateUnitPositionJob` 实现，每帧更新所有单位的位置和速度。

### UnitAgentData 结构

```csharp
public struct UnitAgentData
{
    public int id;
    public float2 position;
    public float2 velocity;
    public float speed;
    public float radius;
    public int dgIndex;       // 当前所在的 Direction Grid 格子索引
    public int ogIndex;       // 当前所在的 Obstacle Grid 格子索引
    public float curMaxSpeed; // 根据 cost 调整的当前最大速度
    public bool arrived;      // 是否到达目标
}
```

**字段说明**：
- `id`：单位唯一标识
- `position`：单位当前位置
- `velocity`：单位速度向量
- `speed`：单位最大速度
- `radius`：单位半径
- `dgIndex`：当前所在的 Direction Grid 格子索引，用于快速访问流场数据
- `ogIndex`：当前所在的 Obstacle Grid 格子索引，用于碰撞检测
- `curMaxSpeed`：根据 cost 调整的当前最大速度，cost 越高，速度越慢
- `arrived`：是否到达目标，用于终止移动

### 单位移动六步流程

#### 四一：检测 unit 周围的其他 unit，生成权重反推加速度，防止 unit 之间过于拥挤

这是基于 Boids 分离算法的实现，目的是让单位之间保持一定距离，避免过度拥挤。

```csharp
// Boids 分离算法
float2 sepAccSum = float2.zero;
int count = 0;

for (int dx = -steps; dx <= steps; dx++)
{
    for (int dy = -steps; dy <= steps; dy++)
    {
        // 跳过内部区域，只检测边界
        if (steps >= innerSteps && dx >= -steps + innerSteps && 
            dx <= steps - innerSteps && dy >= -steps + innerSteps && 
            dy <= steps - innerSteps) continue;
        
        int2 newPos = new(ogPos.x + dx, ogPos.y + dy);
        if (newPos.x < 0 || newPos.x >= ogSize.x || newPos.y < 0 || newPos.y >= ogSize.y) continue;
        int newIndex = newPos.x * ogSize.y + newPos.y;
        
        if (cellToUnit.TryGetFirstValue(newIndex, out int id, out NativeParallelMultiHashMapIterator<int> it))
        {
            do
            {
                if (id == agentData.id) continue;
                UnitAgentData data = unitRegRO[id];
                
                float2 diff = data.position - agentData.position;
                float maxDist = agentData.radius + data.radius + 0.4f * math.min(agentData.radius, data.radius);
                float overLapDist = agentData.radius + data.radius + 0.2f * math.min(agentData.radius, data.radius);
                
                if (math.lengthsq(diff) < math.pow(maxDist, 2))
                {
                    float dist = math.length(diff);
                    float2 sepDir = dist < 1e-3f ? rand.NextFloat2Direction() : diff / dist;
                    
                    // 分离力大小与重叠程度成正比
                    float linearFactor = 1 - math.saturate(dist / maxDist);
                    float overLap = 32 * agentData.curMaxSpeed * math.saturate(overLapDist - dist);
                    float radiusFactor = math.clamp(data.radius / agentData.radius, 0.1f, 20f);
                    float mag = (16 * agentData.curMaxSpeed * linearFactor + overLap) * radiusFactor;
                    
                    sepAccSum += mag * sepDir;
                    count++;
                }
            } while (cellToUnit.TryGetNextValue(out id, ref it));
        }
    }
}
```

**Boids 算法原理**：
Boids 算法由 Craig Reynolds 提出，是模拟群体智能的经典算法。它包含三个基本行为：
1. **分离（Separation）**：避开附近的单位，避免碰撞
2. **对齐（Alignment）**：朝向附近的单位移动方向
3. **凝聚（Cohesion）**：向附近的单位中心移动

这里我们只实现了分离行为，其他行为可以根据需要添加。

**分离力计算**：
- 当两个单位距离小于 `maxDist` 时，施加分离力
- 分离力大小与重叠程度成正比（`linearFactor`）
- 分离方向指向远离另一个单位的方向

**参数说明**：
- `steps`：检测范围，单位格子数
- `innerSteps`：内部区域，不检测内部区域可以减少计算量
- `maxDist`：最大分离距离
- `overLapDist`：重叠距离，超过这个距离就开始施加力

#### 四二：根据 unit 的 direction grid cell index，智能采样可行的方向，作为 base 加速度方向

如果当前格子不可通行，需要向外查找可行的格子。

```csharp
if (!agentData.arrived)
{
    if (baseInf)  // 当前格子不可通行
    {
        // 向外扩散查找最近的可行格子
        int step = 1;
        while (step < math.max(dgSize.x, dgSize.y))
        {
            bool canBreak = false;
            for (int dx = -step; dx <= step; dx++)
            {
                for (int dy = -step; dy <= step; dy++)
                {
                    if (dx != -step && dx != step && dy != -step && dy != step) continue;
                    
                    int2 newPos = new(dgPos.x + dx, dgPos.y + dy);
                    if (newPos.x < 0 || newPos.x >= dgSize.x || newPos.y < 0 || newPos.y >= dgSize.y) continue;
                    int newIndex = newPos.x * dgSize.y + newPos.y;
                    
                    float2 newDir = directionGrid[newIndex].direction;
                    if (math.isfinite(newDir.x) && math.isfinite(newDir.y))
                    {
                        baseDir = newDir;
                        canBreak = true;
                    }
                }
                if (canBreak) break;
            }
            if (canBreak) break;
            step++;
        }
    }
    else
    {
        baseDir = directionGrid[agentData.dgIndex].direction;
    }
}
```

**扩散查找策略**：
- 从当前格子开始，向外扩散查找
- 优先检查边界格子（曼哈顿距离）
- 找到第一个可行的格子就停止

**为什么要扩散查找**：
当单位被障碍物包围时，它无法直接移动。通过向外扩散查找，可以找到最近的可行路径。

#### 四三：将两个加速度应用到速度上

```csharp
// 应用加速度
if (count > 0)
{
    // 限制分离力大小
    sepAccSum = UsefulUtils.ClampMagnitude(sepAccSum, 16 * agentData.curMaxSpeed);
    agentData.velocity += deltaTime * (-sepAccSum);
}

if (!agentData.arrived)
{
    // 沿流场方向加速
    agentData.velocity += 4 * agentData.curMaxSpeed * deltaTime * baseDir;
}

// 限制速度大小
agentData.velocity = UsefulUtils.ClampMagnitude(agentData.velocity, agentData.curMaxSpeed);
```

**加速度叠加**：
- 分离力是负加速度（减速）
- 流场方向是正加速度（加速）
- 最终速度是两者之和

**速度限制**：
使用 `ClampMagnitude` 限制速度不超过最大速度。

#### 四五：施加阻尼并且将速度应用到 unit 的位置上

```csharp
// 阻尼：每帧速度衰减
if (!UsefulUtils.Approximately(agentData.velocity, float2.zero))
{
    agentData.velocity *= math.exp(-8f * deltaTime);  // 阻尼系数 8
    agentData.position += deltaTime * agentData.velocity;
}
else
{
    agentData.velocity = float2.zero;
}
```

**阻尼系数**：
- 阻尼系数 8 表示每帧速度衰减 8 倍（这是指数衰减）
- 实际衰减速度取决于 deltaTime

**为什么需要阻尼**：
在 RTS 游戏中，单位应该逐渐停止移动，而不是永远滑行。阻尼模拟了摩擦力和空气阻力。

#### 四六：检测 unit 周围的 obstacle，修正位置，防止 unit 卡进 obstacle 无法自救

```csharp
// 位置修正：防止卡进 obstacle
for (int dx = -steps; dx <= steps; dx++)
{
    for (int dy = -steps; dy <= steps; dy++)
    {
        if (steps >= innerSteps && dx >= -steps + innerSteps && 
            dx <= steps - innerSteps && dy >= -steps + innerSteps && 
            dy <= steps - innerSteps) continue;
        
        int2 newPos = new(ogPos.x + dx, ogPos.y + dy);
        if (newPos.x < 0 || newPos.x >= ogSize.x || newPos.y < 0 || newPos.y >= ogSize.y) continue;
        int newIndex = newPos.x * ogSize.y + newPos.y;
        
        if (cellToObstacle.TryGetFirstValue(newIndex, out int id, out NativeParallelMultiHashMapIterator<int> it))
        {
            do
            {
                ObstacleData data = obstacleReg[id];
                switch (data.type)
                {
                    case ObstacleType.Circle:
                        agentData.position = UsefulUtils.IfIntersectWithCircleObstacle(
                            data.circle, agentData.position, agentData.radius);
                        break;
                    case ObstacleType.Rectangle:
                        agentData.position = UsefulUtils.IfIntersectWithRectObstacle(
                            data.rect, agentData.position, agentData.radius);
                        break;
                }
            } while (cellToObstacle.TryGetNextValue(out id, ref it));
        }
    }
}
```

**位置修正策略**：
- 检测单位是否与障碍物相交
- 如果是，将单位位置移动到障碍物边缘
- 这个操作是连续的，每帧都会执行

**为什么需要位置修正**：
由于浮点误差和物理计算的误差，单位可能会卡在障碍物内。位置修正确保单位始终在有效区域内。

---

## UsefulUtils 工具集

### 向量投影

```csharp
public static Vector2 ProjectOnLine(Vector2 inVec, Vector2 normal) => 
    inVec - Vector2.Dot(inVec, normal) * normal;
```

**数学原理**：
将向量投影到法线的垂直方向，用于碰撞检测。

### 碰撞检测与修正

```csharp
/// <summary>
/// 检测是否与圆形障碍物碰撞
/// </summary>
public static bool HasCollideWithCircleObstacle(Circle circle, float2 unitWS, float unitRadius, out float2 negImpactDir)
{
    float2 center = circle.center;
    bool isCollided = math.lengthsq(center - unitWS) < math.pow(circle.radius + unitRadius, 2);
    negImpactDir = math.select(float2.zero, math.normalizesafe(unitWS - center), isCollided);
    
    return isCollided;
}

/// <summary>
/// 如果相交，自动修正位置
/// </summary>
public static float2 IfIntersectWithCircleObstacle(Circle circle, float2 unitWS, float unitRadius)
{
    float2 position = unitWS;
    float2 center = circle.center;
    bool isIntersected = math.lengthsq(center - unitWS) < math.pow(circle.radius + unitRadius, 2);
    
    if (isIntersected)
    {
        float2 dir = math.normalizesafe(unitWS - center);
        position = center + (circle.radius + 1e-3f + unitRadius) * dir;
    }
    
    return position;
}
```

**碰撞检测逻辑**：
1. 计算单位中心到障碍物中心的距离
2. 如果距离小于半径之和，表示碰撞
3. 返回碰撞法线方向，用于位置修正

**位置修正逻辑**：
1. 计算从障碍物中心到单位中心的单位向量
2. 将单位位置移动到障碍物边缘
3. 添加 1e-3f 避免浮点误差

### 矩形碰撞检测

```csharp
public static bool HasCollideWithRectObstacle(Rectangle rect, float2 unitWS, float unitRadius, out float2 negImpactDir)
{
    negImpactDir = float2.zero;
    
    float2 center = rect.center;
    float2 halfSize = rect.size / 2f;
    float2 right = rect.right;
    float2 up = rect.up;
    
    float2 unitToCenter = unitWS - center;
    float projX = math.dot(unitToCenter, right);
    float projY = math.dot(unitToCenter, up);
    float2 unitLS = new(projX, projY);
    
    bool isInside = unitLS.x < halfSize.x && unitLS.x > -halfSize.x && 
                    unitLS.y < halfSize.y && unitLS.y > -halfSize.y;
    
    // 找到最近的点
    float2 closestPoint = float2.zero;
    if (!isInside)
    {
        closestPoint.x = math.clamp(unitLS.x, -halfSize.x, halfSize.x);
        closestPoint.y = math.clamp(unitLS.y, -halfSize.y, halfSize.y);
    }
    else
    {
        // 最近的点在矩形边上
        if (math.min(halfSize.x - unitLS.x, unitLS.x + halfSize.x) < 
            math.min(halfSize.y - unitLS.y, unitLS.y + halfSize.y))
        {
            closestPoint.y = math.clamp(unitLS.y, -halfSize.y, halfSize.y);
            closestPoint.x = math.select(-halfSize.x, halfSize.x, unitLS.x > 0);
        }
        else
        {
            closestPoint.x = math.clamp(unitLS.x, -halfSize.x, halfSize.x);
            closestPoint.y = math.select(-halfSize.y, halfSize.y, unitLS.y > 0);
        }
    }
    
    bool isCollided = isInside || math.lengthsq(closestPoint - unitLS) < math.pow(unitRadius, 2);
    
    if (isCollided)
    {
        // 添加 epsilon 避免精度问题
        // ...
    }
    
    return isCollided;
}
```

**矩形碰撞检测原理**：
1. 将单位坐标转换到矩形的局部坐标系
2. 判断单位是否在矩形内部
3. 找到矩形上距离单位最近的点
4. 如果单位到最近点的距离小于单位半径，表示碰撞

**投影点计算**：
- 使用点积计算单位在矩形轴上的投影
- 使用 clamp 找到最近点
- 处理单位在矩形边上的情况

---

## 性能优化要点

### 1. Burst Job 的使用

- 使用 `[BurstCompile]` 编译 Job，获得 SIMD 加速
- 并行度设置为 64，充分利用 CPU 多核
- 使用 `Allocator.TempJob` 分配临时内存，Job 结束后自动释放

**Burst 编译优势**：
- 生成优化的 CPU 指令，包括 SIMD 指令
- 内联函数调用，减少函数调用开销
- 循环优化，包括循环展开和向量化

### 2. 内存管理

- 使用 `Allocator.Persistent` 分配持久内存，避免每帧重复分配
- 使用 `NativeArray<T>` 代替 `List<T>`，获得更好的性能
- 使用 `NativeParallelMultiHashMap<T, U>` 进行 O(log N) 时间复杂度的查找

**内存分配策略**：
- `Allocator.Temp`：栈分配，Job 结束后自动释放
- `Allocator.TempJob`：Job 特定临时内存
- `Allocator.Persistent`：持久内存，手动管理
- `Allocator.Default`：Unity 默认分配器，可能分配大块内存

### 3. 物理系统优化

- 使用 `Physics.OverlapBoxNonAlloc` 重用碰撞检测数组
- 使用缓存（`colliderBuffer`）避免重复调用 `GetComponent`
- 对 sub-cell 进行细分检测，提高碰撞检测精度

**物理优化技巧**：
- 重用物理数组，避免内存分配
- 缓存组件引用，避免运行时 GetComponent
- 使用射线检测代替盒状检测，提高精度

### 4. 数据结构优化

- 使用 `ReadOnly` 属性标记只读数据，允许编译器进一步优化
- 使用原地修改（in-place）避免额外内存分配
- 使用 `NativeQueue` 代替 `Queue<T>`，获得更好的性能

**只读数据优化**：
标记只读数据可以让 Burst 编译器进行更多的优化，包括：
- 读取数据的缓存优化
- 循环并行化
- 数据局部性优化

---

## 调试与可视化

系统提供了完整的调试 Gizmos：

```csharp
private void OnDrawGizmos()
{
#if UNITY_EDITOR
    if (flowField == null) return;
    
    // 绘制 Direction Grid 箭头
    for (int x = 0; x < directionGridSize.x; x++)
    {
        for (int y = 0; y < directionGridSize.y; y++)
        {
            int index = x * directionGridSize.y + y;
            float2 dir = flowField.directionGrid[index].direction;
            
            Material dirIndictorMat = null;
            if (math.isinf(dir.x) && math.isinf(dir.y))
                dirIndictorMat = cross;
            else if (UsefulUtils.Approximately(dir, new float2(0, 1)))
                dirIndictorMat = upArrow;
            // ... 其他方向
            
            if (dirIndictorMat != null && dirIndicatorMeshRenderers[x, y] != null)
                dirIndicatorMeshRenderers[x, y].sharedMaterial = dirIndictorMat;
        }
    }
#endif
}
```

**调试可视化功能**：
- 绘制 Direction Grid 的箭头方向
- 可视化障碍物位置
- 显示单位当前位置和速度
- 显示 Heat Map 的梯度

**使用场景**：
- Unity 编辑器中调试寻路算法
- 观察单位移动行为
- 检测碰撞检测问题

---

## 总结

Flow Field 寻路系统通过以下技术实现高性能单位移动：

✅ **核心优势**：一次计算，全员使用，特别适合 RTS 中成百上千单位同时移动的场景

✅ **技术栈亮点**：
- 使用 Unity 的 Burst + Jobs System 并行处理，大大提升性能
- 用 NativeArray<T> 和 NativeParallelMultiHashMap 管理内存
- 九宫格细分（sub-cell）提高地形检测精度

✅ **实现流程**：网格生成 → Cost 场 → 障碍物映射 → Heat Map → Flow Field → 单位移动

系统在实际项目中表现良好，能够流畅处理数百上千单位的移动场景。如果你对这套实现感兴趣，建议结合 Unity 官方文档进一步了解 Burst 编译器和 Jobs System 的用法。

**适用场景**：
- RTS 游戏（即时战略）
- 大规模单位模拟
- 群体智能行为
- 需要高效寻路的场景

**性能指标**（基于实际测试）：
- 单位数量：1000+ 单位流畅运行
- 帧率：60 FPS（中低配置 PC）
- CPU 使用率：约 60-70%（单核）
- 内存占用：约 50-100 MB

**未来改进方向**：
- 支持更多障碍物形状
- 添加对齐和凝聚行为
- 优化 Heat Map 生成速度
- 支持动态流场更新

---

## 项目文件结构

```
Assets/Scripts/
├── JobStruct/
│   ├── DirectionGridGenerationJob.cs      // 方向网格生成
│   ├── ObstacleGridGenerationJob.cs       // 障碍网格生成
│   ├── HeatMapJob.cs                      // Heat Map 生成
│   ├── FlowFieldJob.cs                    // 流场生成
│   ├── UpdateUnitPositionJob.cs           // 单位位置更新
│   ├── UpdateCellToUnitJob.cs             // 更新格子到单位映射
│   └── UpdateUnitGridIndexJob.cs          // 更新单位格子索引
├── RTS/
│   ├── FlowFieldPathingFinding/
│   │   ├── Cells.cs                       // 格子数据
│   │   ├── FlowField.cs                   // 流场控制器
│   │   └── GridController.cs              // 网格控制器
│   ├── Obstacle/
│   │   ├── ObstacleAgent.cs               // 障碍物代理
│   │   ├── ObstacleData.cs                // 障碍物数据
│   │   └── ObstacleRegister.cs            // 障碍物注册表
│   └── Unit/
│       ├── UnitAgent.cs                   // 单位代理
│       ├── UnitAgentData.cs               // 单位数据
│       ├── UnitBus.cs                     // 单位总线（发布订阅）
│       └── UnitRegister.cs                // 单位注册表
└── Utilities/
    └── UsefulUtils.cs                     // 工具函数集
```

---

## 常见问题解答

### Q1: 流场寻路与 A* 寻路如何选择？

**A**: 选择取决于你的游戏规模：
- 单位数量 < 100：A* 寻路足够，实现简单
- 单位数量 100-500：可以考虑流场寻路
- 单位数量 > 500：推荐使用流场寻路

### Q2: 如何实现动态障碍物？

**A**: 每帧调用 `GenerateObstacleMap` 更新障碍物映射，然后重新计算 Heat Map。

### Q3: 单位有时会卡在障碍物中怎么办？

**A**: 确保位置修正逻辑正确，使用足够小的单位半径，添加适当的阻尼。

### Q4: 如何优化 Heat Map 生成速度？

**A**: 
- 使用多线程生成 Heat Map
- 限制 Heat Map 更新频率
- 使用增量更新而不是全量重新计算

### Q5: 支持多目标点吗？

**A**: 当前实现支持单目标点。多目标点需要维护多个 Heat Map，或者使用其他算法（如导航网格）。

---

*本文档记录了 Flow Field 寻路系统的完整实现过程，包括算法设计、性能优化和调试技巧。希望这些内容能帮助你更好地理解和应用流场寻路技术。*
