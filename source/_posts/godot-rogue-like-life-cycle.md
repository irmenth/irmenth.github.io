---
title: Godot 肉鸽开发记录：手搓一套统一的生命周期
date: 2026-10-07 00:35:00
tags:
  - Godot
  - GDScript
  - 游戏开发
  - 肉鸽
---

## 前言

博主最近在做一个肉鸽小游戏，引擎用 Godot，语言是 GDScript。
项目还在很基础的阶段，真正跑起来的只有网格和它的调试绘制，其余的系统都还在往上搭。
不过地基已经先铺了一层，这篇想聊的就是这层地基里最核心的部分：一套自己写的生命周期。

Godot 自带的钩子其实够用，`_ready` 初始化，`_process` 跑逻辑，`_exit_tree` 收尾。
博主认为缺的不是钩子，而是一份约定。
项目里的管理器是分层挂的，`LifeCycleController` 下面挂着 `ManagerController`，再下面是各个 Manager。
没有约定的话，每个管理器什么时候初始化、什么时候断开信号、什么时候释放，就全靠写的人自觉。
而顺序一旦靠自觉，跨层级的依赖就没法从代码里看出来。

重复调用也是同一类问题。
订阅和退订要成对，初始化只能跑一次，销毁之后不该再收到回调。
这些判断如果让每个管理器自己写，会重复很多遍，也总有人会漏。

上 autoload 是很自然的想法，博主觉得它只能解决「哪里都能拿到」，顺序和销毁还是没人管。

所以博主决定把它们收拢到一处，做成一份写死的约定。

代价也说在前面。
转发靠字符串调用宿主的方法，方法名写错了编辑器不会提醒，要到运行时才知道。
系统之间靠单例互相找，耦合比较重。
不过在目前这个规模下，这套方案换来的确定性是划算的。
真到了要还账的时候再拆也不迟。

好了，闲言少叙，让我们开始吧！

## 先把阶段定下来

钩子本身是够的，博主想要的是一条明确的线。
把它们理顺之后，顺序是这样：

```text
_before_entity_instantiate
_event_subscribe
_initialize
_update / _fixed_update
_event_unsubscribe
_before_destroyed
```

有几个地方是刻意分开的。

订阅和初始化没有合并，是因为它们的时机不一样。
订阅发生在对象进树的时候，这一步只连信号，不做别的。
真正的初始化要等到所有对象都进树了，这时候去拿别的单例才安全。

退订和销毁也没有合并。
对象可能先出树、过一会儿才被销毁，也可能压根没进过树就被销毁了。
放在一起写，总有一种情况会漏掉。

至于 `_before_entity_instantiate`，它要更早一点，后面讲转发的时候会提到。

## 用一个实体来转发

宿主自己不需要继承什么特殊的基类，只要把这几个方法实现出来就行。
真正负责记录状态、按顺序回调的是一个小对象，叫 `LifeCycleEntity`。

它的构造函数里做的第一件事，就是回头把宿主叫醒。

```gdscript
func _init(p_host: Object) -> void:
    host = p_host
    _host_name = p_host.name if p_host is Node else p_host.get_class()
    host.call(&"_before_entity_instantiate", self)
```

最后那句是字符串调用。
好处是宿主不必再继承一层接口，`LifeCycle2D` 能用，`LifeCycle3D` 能用，将来想换成 `Control` 也行。
代价是方法名写错了编辑器不会管，要到运行的时候才炸。
博主觉得这是整套设计里最容易出事的地方，改方法名的时候一定要全局搜一遍。

阶段分发出去之后，顺序和状态由实体自己把着。

```gdscript
var _in_tree: bool = false
var _has_initialized: bool = false
var _has_destroyed: bool = false

func start() -> void:
    if _has_destroyed: return

    if _has_initialized:
        push_warning("[%s] 重复执行 start()" % [_host_name])
        return
    _has_initialized = true

    host.call(&"_initialize")
```

这三个标记挡住的都是很具体的麻烦。
`_in_tree` 挡重复订阅，信号连两次的话回调会跑两遍，这种 bug 在编辑器里几乎看不出来。
`_has_initialized` 挡重复初始化，真的重复了会 `push_warning`，因为那通常意味着框架里有人在乱调用。
`_has_destroyed` 挡的是「死而复生」，销毁之后再进来的调用一律丢掉，`update` 也不例外。

把这些判断集中在一个地方，宿主自己就不用每个方法都防一遍了。

## 宿主用起来是什么样

用起来很简单，继承 `LifeCycle2D` 或者 `LifeCycle3D`，把需要的阶段实现出来。
拿项目里的 `GridManager` 举例。

```gdscript
func _before_entity_instantiate(p_entity: LifeCycleEntity) -> void:
    life_entity = p_entity
    self.name = &"GridManager"
    if !_cache_instance(): return

func _initialize() -> void:
    astar_grid = Grid.new(ASTAR_GRID_CONFIG.grid_size, ASTAR_GRID_CONFIG.origin, ASTAR_GRID_CONFIG.cell_radius)
    astar_grid.init_grid()
```

第一个方法里顺手做了两件事，改名和缓存单例。
缓存单例放在最前面是有意的，重复实例的时候要尽早把自己干掉，没必要白跑一遍初始化。

单例的写法在项目里统一了起来。

```gdscript
static var _cached_instance: GridManager = null
static var cached_instance: GridManager:
    get: return _cached_instance if is_instance_valid(_cached_instance) else null

func _cache_instance() -> bool:
    if is_instance_valid(_cached_instance):
        self.queue_free()
        return false

    _cached_instance = self
    return true
```

`cached_instance` 是对外用的那个，取值的时候带一层 `is_instance_valid`，所以不会拿到已经被释放的对象。
`_cache_instance()` 返回 `false`，意思就是「已经有老大在了」，后来者自己 `queue_free()`。
唯一性靠这种方式保证，别处就不用再写判断。

对应的，单例宿主在 `_before_destroyed` 里要把 `_cached_instance` 置空。
不置空的话，静态变量会一直指着一个已经没了的对象。

## 谁来按顺序调用它们

阶段定好了，宿主也写好了，剩下的问题是按什么顺序去调。
这件事交给了 `LifeCycleController`，由它来把 Godot 的节点回调翻译过去。

```gdscript
func _enter_tree() -> void:
    for e in controller_entities:
        e.enter_tree()

func _ready() -> void:
    for e in controller_entities:
        e.start()

func _process(delta: float) -> void:
    for e in controller_entities:
        e.update(delta)
```

每帧的转发就是这几行的事，`_physics_process` 和 `_exit_tree` 也是同样的写法。

系统之间的先后顺序靠注册列表决定。
`LifeCycleController` 里挂着 `ManagerController` 和 `DebuggerController`，`ManagerController` 里又挂着几个管理器。
谁写在前面谁先初始化，仅此而已。

这里有个容易忽略的地方：这个顺序是跨层级的。
比如调试用的网格绘制器要拿 `GridManager`，但这两个宿主并不在同一个控制器里。
所以那两个 `Array` 不是随便排的，它是整套框架里唯一一份「谁先谁后」的声明，改动的时候要看清楚。

销毁这件事没法放在 `_exit_tree` 里做，得绕到 `_notification` 里去接。

```gdscript
func _notification(what: int) -> void:
    if what == NOTIFICATION_PREDELETE:
        for e in controller_entities:
            e.destroy()
```

因为出树只代表离开了场景树，对象本身还活着，甚至可能再被挂回来。
只有 `NOTIFICATION_PREDELETE` 才是对象真正被回收前的最后一个时机，也才配得上「销毁」这个词。

## 尾声

到这一步，这套生命周期已经能撑起项目里所有的管理系统了。
它做的事情很朴素，把「什么时候做什么」写死成几个阶段，再用状态标记把重复调用挡掉。
换来的是一切都变得可预测，任何一个宿主，博主都能说出它在每一帧的哪个时刻被调用。

代价前面也提过了，字符串调用和单例耦合都是要还的账。
如果系统继续膨胀，单例那一层早晚要重新考虑。

下一篇记录博主打算聊聊网格，也就是目前项目里唯一真正跑起来的东西。
各位如果也在折腾自己的框架，不妨先从「生命周期到底分几步」这个问题开始想，答案不一定和博主一样，但想清楚的过程本身就是收获😉
