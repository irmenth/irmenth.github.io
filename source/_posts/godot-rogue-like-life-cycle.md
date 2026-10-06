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

博主最近开了个新坑，打算用 Godot 做一款小体量的肉鸽游戏。
项目目前还处在很基础的阶段，能跑起来的东西不多，摆在最前面的反而是地基。
这篇记录想聊的就是这块地基里比较核心的一层：一套自己写的生命周期。

Godot 自带的 `_ready`、`_process`、`_physics_process`、`_exit_tree` 其实已经够用。
但项目一变大，博主就发现有三个问题会同时冒出来：初始化顺序靠人肉记忆、销毁时机靠自觉、同一套流程被复制很多遍。
所以博主决定不去跟引擎对着干，而是在它上面套一层很薄的壳，把「什么时候该做什么」固定成契约。

好了，闲言少叙，让我们开始吧！

## 整体结构

这层壳由三部分组成。

- `LifeCycleEntity`：一个 `RefCounted` 的代理，持有宿主，负责记录状态并把调用转发给宿主。
- `LifeCycle2D` / `LifeCycle3D`：宿主的抽象基类，声明需要重写的方法。
- `LifeCycleController`：根控制器，负责注册实体并驱动它们。

把它们串起来，目前项目里的结构大概是这样。

```text
LifeCycleController
├── ManagerController
│   ├── GlobalEventManager
│   ├── GridManager
│   └── EnemySpawnManager
└── DebuggerController
    └── GridDrawer
```

挂在场景上的节点里，只有 `LifeCycleController` 参与这套生命周期，剩下的控制器都是它自己 `new` 出来再注册进去的。
换句话说，整个游戏里需要被生命周期管理的对象，都挂在这一棵树上。

## 阶段是怎么划分的

这套生命周期一共划分了六个阶段，调用顺序是固定的。

- `_before_entity_instantiate`：实体刚被构造出来，宿主拿到自己的实体的时刻。
- `_event_subscribe`：连接信号、注册监听。
- `_initialize`：真正的初始化，此时该在的东西都已经在树上了。
- `_update` / `_fixed_update`：每帧与每物理帧。
- `_event_unsubscribe`：断开订阅。
- `_before_destroyed`：对象即将被释放前的最后一件事。

下面逐个说说每个阶段放在哪里、为什么放在那里。

### `_before_entity_instantiate`

第一个阶段和 GDScript 的 `_init` 有关系。
`LifeCycleEntity` 在自己的构造函数里会立刻回调宿主的 `_before_entity_instantiate`，并且把 `self` 传进去。

```gdscript
func _init(p_host: Object) -> void:
    host = p_host
    _host_name = p_host.name if p_host is Node else p_host.get_class()
    host.call(&"_before_entity_instantiate", self)
```

所以宿主在这个阶段要做的第一件事，就是把 `life_entity` 存下来：

```gdscript
func _before_entity_instantiate(p_entity: LifeCycleEntity) -> void:
    life_entity = p_entity
    self.name = &"GridManager"
    if !_cache_instance(): return
```

这里博主顺手把「改名」和「缓存单例」也一起做了。
原因是不管后面走不走得到 `_initialize`，这个对象的身份（名字、是不是那个唯一的单例）都得先确定下来。
尤其是重复实例的情况，早点发现就能早点把自己干掉，不用白跑一遍初始化。

顺带一提，这个阶段之所以不能塞进宿主自己的 `_init` 里，是因为宿主的 `_init` 在 `new()` 的瞬间就跑完了，那时候 `life_entity` 这个基类字段还是空的。
由实体的构造函数回头来调用宿主，顺序才是对的。

### `_event_subscribe`

这一阶段只管把信号连上，断开交给对应的 `_event_unsubscribe`。
以项目里的调试网格绘制器为例。

```gdscript
func _event_subscribe() -> void:
    GlobalEventManager.cached_instance.main_camera_readied.connect(_cache_main_cam)

func _event_unsubscribe() -> void:
    GlobalEventManager.cached_instance.main_camera_readied.disconnect(_cache_main_cam)
```

连接和断开被拆成两个阶段，而不是塞进 `_ready` 和 `_exit_tree`。
因为在这套生命周期里，离开树的时刻和销毁的时刻是两件事。
对象可能先出树、过一会儿才被销毁，也可能压根没进过树就被销毁了，所以订阅和退订必须各自独立、并且成对出现。

`_event_subscribe` 里直接用的是 `GlobalEventManager.cached_instance`，能不能拿到东西完全看注册顺序。
也就是说，订阅阶段虽然只有一句 `connect`，但它其实已经被顺序约束住了：谁先被注册，谁就先连上信号。

### `_initialize`

真正的初始化放在这里。
此时对象已经在树上了，拿单例、读配置、建数据都可以放心去做了。

```gdscript
func _initialize() -> void:
    astar_grid = Grid.new(ASTAR_GRID_CONFIG.grid_size, ASTAR_GRID_CONFIG.origin, ASTAR_GRID_CONFIG.cell_radius)
    astar_grid.init_grid()
```

这里有个很容易被忽略的点：`GridDrawer` 在初始化时要拿 `GridManager`，而这两个宿主并不在同一个控制器里。
`GridManager` 归 `ManagerController` 管，`GridDrawer` 归 `DebuggerController` 管，所以顺序约束是跨层级的，最终由控制器列表和每一层的宿主列表共同决定。
那两个 `Array` 不是随便排的，它是这套框架里唯一一份「谁先谁后」的声明。

### `_update` 与 `_fixed_update`

这两个阶段只是转发，宿主自己去实现真正的逻辑。
需要注意的是 `_fixed_update` 走的是物理帧，跟 `_update` 不是同一个时间轴，别把需要稳帧的东西塞进 `_update`。

项目里 `GridDrawer` 用它来做一件很有意思的事：只在相机移动过的时候才重新画一遍。

```gdscript
func _update(_delta: float) -> void:
    if _cached_cam_pos.is_equal_approx(_main_cam.global_position): return

    _cached_cam_pos = _main_cam.global_position
    self.queue_redraw()
```

这个阶段还有一个隐藏约束：销毁之后的 `update` 会被静默跳过。
也就是说宿主不需要在 `_update` 里自己判断「我是不是已经死了」。

### `_before_destroyed`

对象即将被释放前的最后一件事。
单例宿主在这里做一件很关键的事，把自己的缓存置空。

```gdscript
func _before_destroyed() -> void:
    if _cached_instance == self:
        _cached_instance = null
```

如果不置空，静态变量就会一直指着一个已经被释放的对象。
虽然 `cached_instance` 的 getter 里做了 `is_instance_valid` 判断兜底，但那是补救，不是设计。

## 谁在转发这些阶段

阶段是宿主实现的，但顺序和状态是 `LifeCycleEntity` 管的。
它自己的实现其实很短，核心就是三个标记加一串转发。

```gdscript
var _in_tree: bool = false
var _has_initialized: bool = false
var _has_destroyed: bool = false

func enter_tree() -> void:
    if _has_destroyed: return

    if !_in_tree:
        _in_tree = true
        host.call(&"_event_subscribe")

func start() -> void:
    if _has_destroyed: return

    if _has_initialized:
        push_warning("[%s] 重复执行 start()" % [_host_name])
        return
    _has_initialized = true

    host.call(&"_initialize")
```

`update`、`fixed_update`、`exit_tree` 的写法大同小异，都是先看 `_has_destroyed`，再做该做的事。
把这些防御集中在一个地方，好处是所有宿主都自动获得，不用每个类都抄一遍。

这里博主用了 `host.call(&"_xxx")` 这种字符串调用，而不是定义一个接口类去继承。
好处是宿主不必再继承一层，`LifeCycle2D` 和 `LifeCycle3D` 都行，将来 `Control` 也行。
代价是方法名写错了编辑器不会报错，要到运行时才会炸。
这是这套设计里博主认为最需要小心的地方，改方法名的时候一定要全局搜一遍。

## 状态标记保证了什么

`_in_tree`、`_has_initialized`、`_has_destroyed` 这三个标记不是装饰，它们各自挡住了一类问题。

- `_in_tree`：挡住重复订阅。信号连两次，回调就会执行两次，这种 bug 在编辑器里几乎看不出来。
- `_has_initialized`：挡住重复初始化。重复 `start()` 会 `push_warning`，因为这通常意味着框架里有人乱调用。
- `_has_destroyed`：挡住「死后复活」。销毁之后再进来的任何调用都会被丢弃，包括 `update`。

另外一个细节藏在 `destroy()` 里，顺序值得单独看看。

```gdscript
func destroy() -> void:
    if _has_destroyed:
        push_warning("[%s] 重复销毁" % [_host_name])
        return
    _has_destroyed = true

    if is_instance_valid(host):
        if _in_tree:
            _in_tree = false
            host.call(&"_event_unsubscribe")
        host.call(&"_before_destroyed")

    _release_host()
    host = null
```

它先把 `_has_destroyed` 置为 `true`，再回调宿主。
这样即使宿主在 `_before_destroyed` 里做了什么奇怪的事，也不会再触发一轮销毁。
而 `_in_tree` 的补充判断是为了兜底：万一对象没走过 `exit_tree` 就直接销毁，也必须把订阅断掉，否则又是一堆野回调。

最后一句 `host = null` 是给非 Node 宿主用的。
Node 宿主会被 `_release_host()` 处理掉，普通对象则靠这一句断开引用，不然 `RefCounted` 就漏了。

## 宿主是 Object，不是 Node

`LifeCycleEntity.host` 的类型是 `Object`，不是 `Node`。
这带来两个后果，一个好处一个麻烦。

好处是任何对象都能当宿主，将来想让一个纯数据类也吃这套生命周期，不用先给它套个节点。
麻烦则是「怎么把它放进场景树」这件事没法统一处理，只能判断。

```gdscript
func attach(p_parent: Node) -> void:
    if host is Node: p_parent.add_child(host)
```

目前项目里所有宿主都是 `Node2D` 或 `Node3D`，走到 `attach` 的时候都会被挂上去。
非 Node 宿主只是先留了口子，还没有真正的用例。

## 单例的缓存规范

项目里几乎每个宿主都是单例，因为跨系统互相找的时候，一路 `get_node` 太痛苦了。
博主在基类注释里把写法固定了下来，每个单例宿主都长这样。

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

拆开看是三个约定。

1. `cached_instance` 是对外暴露的只读入口，getter 里带 `is_instance_valid` 兜底，永远不返回野指针。
2. `_cache_instance()` 返回 `false` 表示「已经有老大在了」，后来者就把自己 `queue_free()` 掉。这样「唯一性」是靠自我了断实现的，不用在别处写判断。
3. `_before_destroyed` 里置空 `_cached_instance`。

## 谁来驱动这一切

阶段都定义好了，那谁按顺序去调它们？
答案是 `LifeCycleController` 自己，它负责把 Godot 的节点回调翻译过来。

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

func _physics_process(fixed_delta: float) -> void:
    for e in controller_entities:
        e.fixed_update(fixed_delta)

func _exit_tree() -> void:
    for e in controller_entities:
        e.exit_tree()

func _notification(what: int) -> void:
    if what == NOTIFICATION_PREDELETE:
        for e in controller_entities:
            e.destroy()
```

这里有两处值得说。

一是销毁用的是 `NOTIFICATION_PREDELETE`，而不是 `_exit_tree`。
`_exit_tree` 只代表离开了场景树，对象本身还活着，甚至可能再被挂回来。
只有 `NOTIFICATION_PREDELETE` 才是对象真正被回收前的最后一个时机，也才配得上「销毁」这个词。

二是注册这件事放在 `_init` 里做，而不是 `_ready`。

```gdscript
func _init() -> void:
    if !_cache_instance(): return

    controller_entities.clear()
    LifeCycleController.register_entities(controller_entities, controller_hosts)
    LifeCycleController.add_child_through_entities(self, controller_entities)
```

因为 `LifeCycleEntity` 的构造函数会立刻回调 `_before_entity_instantiate`，而 `_enter_tree` 之前又必须把实体准备好，所以只能放在 `_init` 里。
注意 `_cache_instance()` 的判断在前，这意味着一个「重复的控制器」不会注册任何实体，直接就退场了。

至于控制器自己怎么被创建：`LifeCycleController` 是写在场景里的节点，`ManagerController` 和 `DebuggerController` 写在它的 `controller_hosts` 里，而更下层的管理器写在 `ManagerController` 的 `manager_hosts` 里。
所以每个控制器只需要关心自己下一层的列表，层次关系一目了然。

## 尾声

到这一步，这套生命周期已经能撑起项目里所有的管理系统了。
它做的事情其实很朴素：把「什么时候做什么」写死成六个阶段，再用三个标记把重复调用挡掉。
换来的是一切都变得可预测——任何一个宿主，博主都能说出它在每一帧的哪个时刻被调用。

当然它也不是没有代价。
字符串调用换来的灵活性，代价是失去了编译期检查；单例换来的方便，代价是模块之间耦合得很深。
这些取舍在项目当前这个规模下是划算的，但如果系统继续膨胀，单例那一层早晚要重新考虑。

下一篇记录博主打算聊聊网格，也就是目前项目里唯一真正跑起来的东西。
各位如果也在折腾自己的框架，不妨先从「生命周期到底分几步」这个问题开始想，答案不一定和博主一样，但想清楚的过程本身就是收获😉
