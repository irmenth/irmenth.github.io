---
title: Godot 肉鸽开发记录：搭一个自己的网格
date: 2026-10-07 01:25:00
tags:
  - Godot
  - GDScript
  - 游戏开发
  - 肉鸽
---

## 前言

上一篇记录了博主给项目手搓的那套生命周期，这一篇聊聊目前唯一真正跑起来的东西，网格。

肉鸽游戏和网格的缘分不用多说，走位、寻路、房间划分、技能范围，最后都要落到「第几行第几列」上。
Godot 其实自带了 `TileMapLayer` 和 `AStarGrid2D`，一个本职是铺贴图，一个本职是寻路，都能直接拿来用。

那为什么不直接用呢？
博主的想法是，这两个东西关心的都不是「我这个游戏里的格子是什么」。
`TileMapLayer` 关心的是长什么样，一旦格子跟贴图解绑就没有意义了。
`AStarGrid2D` 关心的是怎么走，它自己有自己的一套坐标，跟游戏里其他系统对不上。
将来做房间生成、技能范围、迷雾，都要跟它那套坐标绕一圈。

所以博主宁可自己写一层很薄的网格，只管坐标换算。
它不负责长什么样，只负责回答两个问题：一个世界坐标落在哪个格子里，以及一个格子的中心在世界里的哪个位置。
把它想明白之后，寻路、可行走性这些都可以往上加，不用迁就别人的数据结构。

代价是得自己保证换算不出错，也没有现成的调试工具。
目前这块还处在很基础的阶段，只做了尺寸描述、坐标换算，以及在调试时把自己画出来。
至于寻路和房间生成，都还没轮到它们上场。

好了，闲言少叙，让我们开始吧！

## 先把坐标系定下来

在写换算之前，得先约定清楚坐标怎么摆，不然公式写了一堆，方向反了自己都不知道。

博主把网格铺在世界空间的 XZ 平面上，y 轴专门留给高度。
所以一个格子的二维坐标 `(x, y)`，对应到世界空间里是 x 和 z，这一点在后面看换算的时候会体现出来。

还有两个概念要先说清楚。
一个是 `origin`，它是网格最小角的位置，不是中心，也不是第一个格子，所以格子 0 的中心并不在 `origin` 上，而是往里挪了半个格子。
另一个是 `cell_radius`，它其实是格子中心到边的距离，也就是半个边长。
叫它半径有点随性，不过直径可以直接从它推出来。

```text
cell_diameter = cell_radius * 2
```

这三个约定记住了，后面的公式基本都能自己推。

## 把格子铺开

配置放在一个 `Resource` 里，尺寸、原点、半径各一个字段，可以在编辑器里存成 `.tres` 文件，改数值不用碰代码。
网格本体则只收构造参数，自己做初始化。

博主没有用二维数组，而是把全部格子一列一列地铺进一维数组里。

```text
function build_cells(columns, rows)
    total = columns * rows
    cells = empty list

    for index from 0 to total - 1
        column = index / rows rounded down
        row = index mod rows
        center.x = origin.x + cell_radius + column * cell_diameter
        center.y = origin.y
        center.z = origin.z + cell_radius + row * cell_diameter
        append cell(index, center) to cells

    return cells
```

这里 `index` 是格子在一维数组里的下标，要反推出它落在第几列、列内第几个，其实就是「`index` 里包含了几整列」和「余下几个」。
`column` 用整除拿列号，`row` 用取余拿列内偏移。
注意除数是 `rows`，因为格子是沿着行方向一个接一个排的。
写反了不会报错，只会让整个网格的行列悄悄对调，是很容易埋很久的那种 bug。

格子中心的计算可以拆开读。
从原点出发，先走 `column` 个整格，再多走半个格子把自己挪到格子中间去。
之所以用一维数组，是因为按 `index` 直接就能拿到格子，不用写两层下标，后面遍历和洗牌也顺手。

## 反过来查格子

有了格子中心，再问「一个世界坐标落在哪个格子里」就顺理成章了。
推导过程就是把刚才的公式倒过来。

```text
function cell_at(world_position)
    offset = world_position - origin

    if offset.x < 0 or offset.z < 0
        return invalid      # 最小角之外

    column = offset.x / cell_diameter rounded down
    row = offset.z / cell_diameter rounded down
    return (column, row)
```

先减掉 `origin` 把原点搬到网格的最小角，再除以格子边长，得到的就是「跨了几个格子」。
格子是从 0 开始编号的，所以结果向下取整，小数部分直接丢掉。
只有在跨过整整一格之后，编号才会加一。

无效值这里写成了 `invalid`，判断依据是减完原点之后有没有负数。

**提醒**：目前只挡住了负方向，也就是最小角之外的部分。
超出右下角的坐标不会被纠正，也不会报错，会老老实实返回一个越界的格子。
这块等接上寻路之前得补上，不然查询一个远处的坐标就会拿到一个不存在的格子。

二维的版本就只是按约定映射过去，把平面坐标的 X 和 Y 当成世界的 X 和 Z 来用。

```text
function cell_at_2d(flat_position)
    world_position = (flat_position.x, 0, flat_position.y)      # 高度不看，填 0
    return cell_at(world_position)
```

高度那一项写死成 0 是安全的，因为查格子的时候压根不看它。

## 让它显示出来

数据和换算都有了，但看不见东西总是虚的，所以博主加了一个调试用的绘制器。
它不生成任何贴图，也不摆 Sprite，直接在 `_draw` 里画线。
先把网格的边界算出来。

```text
function grid_bounds()
    cell_size = cell_diameter
    min_x = origin.x
    min_z = origin.z
    max_x = origin.x + columns * cell_size
    max_z = origin.z + rows * cell_size
    return (min_x, min_z, max_x, max_z)
```

边界算出来之后，平行 z 轴的线 x 坐标固定，平行 x 轴的线 z 坐标固定。
循环次数都是「格子数 + 1」，因为线总比格子多一条，边界上那两条不能漏。
这里借用了相机的投影函数，让它去做世界坐标到屏幕坐标的投影。

```text
function to_local(world_point)
    screen_point = camera.project(world_point)
    return screen_point * inverse(canvas_transform)      # 屏幕坐标转回节点自身坐标

function line_ends(x, min_z, max_z)
    screen_a = to_local((x, y, min_z))
    screen_b = to_local((x, y, max_z))
    return (screen_a, screen_b)
```

绘制节点本来就是在屏幕空间里作画的，所以拿到屏幕坐标之后，再乘上画布变换的逆矩阵，把坐标转回节点自己的局部坐标系。
这样就不用自己推投影矩阵，相机的参数改了什么，网格会跟着一起变。

**提醒**：这套算法只在正交投影下好看。
透视相机虽然也算得出来，但网格的近大远小会很难看。
博主的项目本来就是个俯视固定视角，所以直接判一下相机是不是正交，不是就跳过这一帧。

相机什么时候就绪同样是通过事件通知的。

```text
function subscribe()
    connect(main_camera_ready, cache_camera)

function cache_camera(camera)
    main_camera = camera
    request_redraw()
```

相机在场景里就被标成了 `current`，再由一个胶水节点在延迟一帧之后把它抛出来。
绘制器收到之后缓存下相机对象，顺便请求一次重绘。
订阅放在进树那个阶段，退订放在出树那个阶段，用的正是上一篇里那套生命周期。

## 只在相机动的时候重绘

画线本身的开销不大，但也没有必要每帧都画。
网格只有在相机移动之后才会在屏幕上错位，所以博主把相机位置缓存了一份。

```text
function update(delta)
    if almost_equal(main_camera.position, remembered_position)
        return      # 相机没动，不用重绘

    remembered_position = main_camera.position
    request_redraw()
```

用近似比较而不是直接判相等，是因为浮点位置几乎不会一模一样。
请求重绘只是排一次队，真正画不画由引擎决定，但一直请求的话它会每帧都画。

## 尾声

到这一步，网格算是能看、能用、也能查了。
它做的事情不复杂，但如果一开始没把坐标系和方向约定清楚，后面每加一个功能都要重新推一遍公式。

这个网格现在还只是个空壳，下一步是让它真正干活，先让每个格子能记录自己通不通过，再接上 A* 寻路。
配置文件叫 `astar_grid_config.tres`，命名就是照着寻路取的。

各位如果也想自己搭网格，建议先别急着写寻路。
先把「世界坐标 ↔ 格子坐标」这一对函数写稳，再写几个用例验证一遍边界，后面会省很多事😉
