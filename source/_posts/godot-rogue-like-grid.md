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

上一篇记录了博主给项目手搓的那套生命周期，这一篇聊聊目前唯一真正跑起来的东西：网格。

肉鸽游戏和网格的缘分不用多说，走位、寻路、房间划分、技能范围，最后都要落到「第几行第几列」上。
Godot 其实自带了 `TileMapLayer` 和 `AStarGrid2D`，前者的本职是铺贴图，后者的本职是寻路，都能直接拿来用。
但博主想要的是一个纯粹的逻辑网格：它不负责长什么样，只负责回答「这个坐标属于哪个格子」「这个格子在世界里的中心在哪」。
于是就有了这几个很小的类。

目前它还处在很基础的阶段，只做了三件事：描述自己的尺寸、把世界坐标换算成格子坐标、以及在调试时把自己画出来。
至于寻路、可行走性、房间生成，都还没轮到它们上场。

## 谁管什么

这一层里一共四个类，各管一段，边界分得很清。

- `GridConfig`：一个 `Resource`，只放配置。
- `Grid`：网格本体，纯数据加坐标换算。
- `Cell`：单个格子，纯数据。
- `GridDrawer`：调试绘制，唯一跟渲染沾边的那个。

关系大概是这样。

```text
GridConfig (Resource)  ──初始化──▶  Grid
                                     └── linear_map: Array[Cell]

GridDrawer (Node2D) ──读取──▶ Grid ──读取──▶ Cell
```

除了 `GridDrawer`，前面三个都不继承 `Node`，也不进场景树。
它们只是普通对象，谁需要谁就持有。
这样做的好处是：网格可以脱离场景单独构造和测试，也不需要为了画几条线而多挂一个节点。

## 配置与本体分开

先把配置单独拎出来。

```gdscript
class_name GridConfig
extends Resource

@export var grid_size: Vector2i = Vector2i(10, 10)
@export var origin: Vector3 = Vector3.ZERO
@export var cell_radius: float = 0.5
```

用 `Resource` 而不是把这些字段直接写在 `GridManager` 上，原因很直接：`Resource` 能在编辑器里存成 `.tres` 文件，改数值不用碰代码，也不用重开项目。

所以 `Grid` 的参数全部由构造函数传进来。

```gdscript
class_name Grid

var grid_size: Vector2i
var origin: Vector3
var cell_radius: float
var cell_diameter: float
var linear_map: Array[Cell] = []

func _init(gs: Vector2i, ori: Vector3, cr: float) -> void:
	grid_size = gs
	origin = ori
	cell_radius = cr
	cell_diameter = cr * 2
```

注意它没有去读配置文件，读配置这件事由 `GridManager` 在 `_initialize` 里做。
`Grid` 只知道一个尺寸、一个原点、一个半径，剩下的都跟它无关。
这样将来想做「关卡里不同区域用不同大小的网格」，只要 `Grid.new` 两次就行，不用动配置类的结构。

## 坐标系先定下来

在写换算之前，得先约定清楚坐标到底怎么摆。

博主把网格铺在世界空间的 **XZ 平面**上，y 轴专门留给高度。
也就是说，一个格子的二维坐标 `(x, y)` 对应到世界空间是 `(x, ?, y)` 里的 x 和 z，这一点在后面看 `v2_to_cell` 的时候会体现出来。

接下来是 `origin` 的含义。
它是网格**最小角**的位置，不是中心，也不是第一个格子。
所以格子 0 的中心并不在 `origin` 上，而是往里挪了半个格子。

最后是 `cell_radius` 这个命名。
它是格子中心到边的距离，也就是半个边长。
叫它半径有点随性，不过直径确实是照着它推出来的：

```gdscript
cell_diameter = cr * 2
```

把这三个约定记住，后面的公式基本都能自己推出来。

## 把二维索引压成一维

初始化的时候，博主没有用二维数组，而是把全部格子按行铺进了一维数组里。

```gdscript
func init_grid() -> void:
	var x: int = 0
	var y: int = 0
	var ws_offset: Vector3 = Vector3.ZERO
	var cell_amount: int = grid_size.x * grid_size.y

	for i in range(0, cell_amount, 1):
		x = floori(i / grid_size.y)
		y = i % grid_size.y
		ws_offset.x = cell_radius + x * cell_diameter + origin.x
		ws_offset.y = origin.y
		ws_offset.z = cell_radius + y * cell_diameter + origin.z
		linear_map.append(Cell.new(i, ws_offset))
```

这里有两个点值得说。

一是索引换算。
`i` 是数组下标，要反推出它落在第几行、行内第几个，其实就是「`i` 里包含了几整行」和「余下几个」。
所以 `x` 用整除拿到行数，`y` 用取余拿到行内偏移。
需要注意的是**行是沿着 y 方向数的**，所以除数是 `grid_size.y` 而不是 `grid_size.x`。
这一点写反了不会报错，只会让整个网格的行列悄悄对调，是很容易埋很久的那种 bug。

二是格子中心的计算。
`cell_radius + x * cell_diameter + origin.x` 这一串可以拆成三段来读：从原点出发，先走 `x` 个整格，再多走半个格子把自己挪到格子中间去。

至于为什么用一维数组，主要是图个方便：`linear_map[i]` 可以直接拿到格子，不需要写两层下标，后面做遍历和洗牌的时候也顺手。

## 从世界坐标找回格子

有了格子的中心点，反过来问「一个世界坐标落在哪个格子里」就顺理成章了。

```gdscript
## (-1, -1) 代表无效
func v3_to_cell(ws: Vector3) -> Vector2i:
	var cell: Vector2i = Vector2i(-1, -1)
	var relative: Vector3 = ws - origin

	if relative.x < 0 || relative.z < 0:
		return cell;

	cell.x = floori(relative.x / cell_diameter)
	cell.y = floori(relative.z / cell_diameter)

	return cell
```

推导过程其实就是把刚才的公式倒过来。
先减去 `origin` 把原点搬到网格的最小角，再除以 `cell_diameter` 得到「跨了几个格子」。
因为格子是从 0 开始编号的，所以对结果取 `floori`，也就是把小数部分直接丢掉。
只有在跨过整整一个 `cell_diameter` 之后，编号才会加一。

无效值用 `(-1, -1)` 表示，这一点是从下界判断来的：减完原点之后只要有负数，就说明这个点在网格外面。
**提醒**：目前只挡住了负方向，也就是最小角之外的部分。
超出右下角的坐标不会被纠正，也不会报错，会老老实实返回一个越界的格子。
这块等接上寻路之前得补上，不然查询一个远处的坐标就会拿到一个不存在的格子。

至于 `Vector2` 的版本，就只是把二维坐标按约定映射过去。

```gdscript
## (-1, -1) 代表无效
func v2_to_cell(ws: Vector2) -> Vector2i:
	return v3_to_cell(Vector3(ws.x, 0, ws.y))
```

这里的 `y` 直接写死成 0 是安全的，因为 `v3_to_cell` 压根不看高度，它只关心 x 和 z。

## 把它画出来

数据和换算都有了，但看不见东西总是虚的，所以博主加了一个调试用的绘制器。

它的做法是不生成任何贴图、不摆任何 Sprite，直接在 `_draw` 里把网格线画出来。

```gdscript
func _draw() -> void:
	if !_grid_manager || !_grid || !_main_cam || (_main_cam && _main_cam.projection != Camera3D.PROJECTION_ORTHOGONAL): return

	var screen_to_local: Transform2D = self.get_global_transform_with_canvas().affine_inverse()
	var d: float = _grid.cell_diameter
	var y: float = _grid.origin.y
	var min_x: float = _grid.origin.x
	var min_z: float = _grid.origin.z
	var max_x: float = _grid.origin.x + _grid.grid_size.x * d
	var max_z: float = _grid.origin.z + _grid.grid_size.y * d
```

先把网格的边界算出来。
`min_x` / `min_z` 就是原点本身，另一头等于原点加上「格子数 × 直径」，也就是整个网格的边长。

接下来的思路是：平行 z 轴的线，x 坐标固定；平行 x 轴的线，z 坐标固定。

```gdscript
# 平行 z 的线，x 不变
for i in range(_grid.grid_size.x + 1):
	var x: float = min_x + i * d
	_line_points.append(screen_to_local * _main_cam.unproject_position(Vector3(x, y, min_z)))
	_line_points.append(screen_to_local * _main_cam.unproject_position(Vector3(x, y, max_z)))

# 平行 x 的线，z 不变
for i in range(_grid.grid_size.y + 1):
	var z: float = min_z + i * d
	_line_points.append(screen_to_local * _main_cam.unproject_position(Vector3(min_x, y, z)))
	_line_points.append(screen_to_local * _main_cam.unproject_position(Vector3(max_x, y, z)))

self.draw_multiline(_line_points, LINE_COLOR)
```

循环次数都是「格子数 + 1」，因为 20 个格子之间有 21 条线，边界上的那两条不能漏。

这里最巧的是 `unproject_position`。
它的本职是把世界坐标投影到屏幕坐标，按理说跟「画线」是两回事。
但 `Node2D` 的 `_draw` 本来就是在屏幕空间里作画的，所以博主干脆让相机去做投影这件事，自己拿到屏幕坐标之后，再乘上 `get_global_transform_with_canvas().affine_inverse()` 把屏幕坐标转回节点自己的局部坐标。
这样就不用自己去推投影矩阵，相机的参数改了什么，网格会跟着一起变。

**提醒**：这也是为什么一开始要判一下相机是不是正交投影。
透视相机下这套「把平面上的点反投影到屏幕」的算法依然能算，但网格的近大远小会变得很难看，而博主这个项目本来就是俯视固定视角，所以直接要求正交。

最后是清空再填充。

```gdscript
_line_points.clear()
```

`_line_points` 是复用的成员数组，每次重绘前清空而不是重新 `new` 一个，这样每帧的开销稳定，也不至于每帧都重新分配一次内存。

另外还有一层防御写在函数最开头：`_grid_manager`、`_grid`、`_main_cam` 三个引用都判了一遍。
它们分别来自配置读取、初始化、以及相机就绪事件，任何一个还没到，这一帧就直接跳过。
在生命周期还没跑完的时候 `_draw` 是有可能被调用的，所以这个判断不是多余的。

## 只在相机动的时候重绘

画线的开销不大，但也没有必要每帧都画。
网格只有在相机移动之后才会在屏幕上错位，所以博主把相机位置缓存了下来。

```gdscript
func _update(_delta: float) -> void:
	if _cached_cam_pos.is_equal_approx(_main_cam.global_position): return

	_cached_cam_pos = _main_cam.global_position
	self.queue_redraw()
```

`queue_redraw()` 只是请求一次重绘，真正画不画由引擎决定，但一直请求的话它会每帧都画。
判断用 `is_equal_approx` 而不是 `==`，是因为浮点位置几乎不会精确相等。

相机什么时候就绪，同样要靠事件来通知。

```gdscript
func _event_subscribe() -> void:
	GlobalEventManager.cached_instance.main_camera_readied.connect(_cache_main_cam)
```

相机在场景里就被标成了 `current`，再由一个胶水节点在 `_ready` 之后延迟一帧把它抛出来。
绘制器收到之后缓存下相机对象，顺便请求一次重绘。
这就是上一篇里那套生命周期真正派上用场的地方：订阅写在 `_event_subscribe`，退订写在 `_event_unsubscribe`，谁先谁后一目了然。

## 尾声

到这一步，网格算是能看、能用、也能查了。
它做的事情不复杂，但如果一开始没把坐标系和方向约定清楚，后面每加一个功能都要重新推一遍公式。
所以博主特别想强调这一点：**先把约定写在注释里，再写代码**。

下一步博主打算把 `Grid` 真正用起来，先是可行走性，让每个格子记录自己能不能通过，然后再上 A* 寻路。
现在配置文件叫 `astar_grid_config.tres`，其实就是为了这一步预留的。

各位如果也想自己搭网格，建议先别急着写寻路。
先把「世界坐标 ↔ 格子坐标」这一对函数写稳，再写几个用例验证一遍边界，后面会省很多事😉
