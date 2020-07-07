## 为什么需要Vuex

通常 `Vue` 项目中的数据通信，我们通过以下三种方式就可以解决，但是随着项目多层嵌套的组件增加，兄弟组件间的状态传递非常繁琐，导致不断的通过事件来变更状态，同步状态多份拷贝，最后代码难以维护。于是尤大大开发了 `Vuex` 来解决这个问题。

- 父传子 `props`；
- 子传父 `$emit`；
- `eventBus` 事件总线。

当然中小 `Vue` 项目可以不使用 `Vuex`，当出现下面这两种情况的时候我们就应该考虑使用 `Vuex` 统一管理状态了。

- 多个视图依赖于同一状态；
- 来自不同视图的行为需要变更同一状态。

使用`Vuex`的优点也很明显：

- 方便全局通信；
- 方便状态缓存；
- 方便通过 `vue-devtools` 来进行状态相关的bug排查。

## Vuex初使用

官方 `Vuex` 上有一张用于解释 `Vuex` 的图，但是并没有给于清晰明确的注释。这里简单说下每块的功能和作用，以及整个流程图的单向数据量的流向。

![Vuex](https://user-gold-cdn.xitu.io/2019/12/28/16f4d28d99045d67?w=701&h=551&f=png&s=8112)

- `Vue Components`：Vue组件。HTML页面上，负责接收用户操作等交互行为，执行 `dispatch` 方法触发对应 `action` 进行回应。

- `dispatch`：操作行为触发方法，是唯一能执行action的方法。

- `actions`：操作行为处理模块。负责处理Vue Components接收到的所有交互行为。包含同步/异步操作，支持多个同名方法，按照注册的顺序依次触发。向后台API请求的操作就在这个模块中进行，包括触发其他 `action` 以及提交 `mutation` 的操作。该模块提供了Promise的封装，以支持action的链式触发。

- `commit`：状态改变提交操作方法。对 `mutation` 进行提交，是唯一能执行mutation的方法。

- `mutations`：状态改变操作方法。是Vuex修改state的唯一推荐方法，其他修改方式在严格模式下将会报错。该方法只能进行同步操作，且方法名只能全局唯一。操作之中会有一些hook暴露出来，以进行state的监控等。

- `state`：页面状态管理容器对象。集中存储 `Vue components` 中 `data`对象的零散数据，全局唯一，以进行统一的状态管理。页面显示所需的数据从该对象中进行读取，利用Vue的细粒度数据响应机制来进行高效的状态更新。

- `Vue组件`接收交互行为，调用 `dispatch` 方法触发 `action` 相关处理，若页面状态需要改变，则调用 `commit` 方法提交 `mutation` 修改 `state`，通过 `getters` 获取到 `state` 新值，重新渲染 `Vue Components`，界面随之更新。

总结：

1. `state`里面就是存放的我们上面所提到的状态。

2. `mutations`就是存放如何更改状态。

3. `getters` 就是从 `state` 中派生出状态，比如将 `state` 中的某个状态进行过滤然后获取新的状态。

4. `actions` 就是 `mutation` 的加强版，它可以通过 `commit` mutations中的方法来改变状态，最重要的是它可以进行异步操作。

5. `modules` 顾名思义，就是当用这个容器来装这些状态还是显得混乱的时候，我们就可以把容器分成几块，把状态和管理规则分类来装。这和我们创建js模块是一个目的，让代码结构更清晰。


##  关于Vuex的疑问

我们做的项目中使用Vuex，在使用Vuex的过程中留下了一些疑问，发现在使用层面并不能解答我的疑惑。于是将疑问简单罗列，最近在看了 `Vuex` 源码才明白。

![image.png](https://user-gold-cdn.xitu.io/2019/12/28/16f4d26dc69a900a?w=891&h=266&f=png&s=65600)

- 如何保证 `state` 的修改只能在 `mutation` 的回调函数中？
- `mutations` 里的方法，为什么可以修改 `state`？
- 为什么可以通过 `this.commit` 来调用 `mutation` 函数？
- `actions` 函数中`context对象`，为什么不是 `store实例` 本身？
- 为什么在`actions函数`里可以调用 `dispatch` 或者 `commit`？
- 通过 `this.$store.getters.xx`，是如何可以访问到 `getter` 函数的执行结果的？

## Vuex源码分析

针对以上疑问，在看Vuex源码的过程中慢慢解惑了。

#### 1. 如何保证 `state` 的修改只能在 `mutation` 的回调函数中？

在`Vuex`源码的 `Store` 类中有个  `_withCommit` 函数：

```javascript
_withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
}
```
 
`Vuex` 中所有对 `state` 的修改都会调用 `_withCommit`函数的包装，保证在同步修改 state 的过程中 `this._committing` 的值始终为 `true`。当我们检测到 `state` 变化的时候，如果 `this._committing `不为   `true`，则能查到这个状态修改有问题。


#### 2. mutations里的方法，为什么可以修改state？

在`Vuex`实例化的时候，会调用 `Store` ，`Store` 会调用 `installModule`，来对传入的配置进行模块的注册和安装。对 `mutations` 进行注册和安装，调用了 `registerMutation` 方法：

```javascript
/**
 * 注册mutation 作用同步修改当前模块的 state
 * @param {*} store  Store实例
 * @param {*} type  mutation 的 key
 * @param {*} handler  mutation 执行的函数
 * @param {*} local  当前模块
 */
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = []) 
  entry.push(function wrappedMutationHandler (payload) { 
    handler.call(store, local.state, payload)
  })
}
```
该方法对mutation方法进行再次封装，注意 `handler.call(store, local.state, payload)`，这里改变 `mutation` 执行的函数的 `this` 指向为 `Store实例`，`local.state` 为当前模块的 `state`，`payload` 为额外参数。

因为改变了 `mutation` 执行的函数的 `this` 指向为 `Store实例`，就方便对 `this.state` 进行修改。

#### 3. 为什么可以通过 `this.commit` 来调用 `mutation` 函数？

在 Vuex 中，mutation 的调用是通过 store 实例的 API 接口 commit 来调用的。来看一下 commit 函数的定义：

```javascript
/**
   * 
   * @param {*} _type mutation 的类型
   * @param {*} _payload 额外的参数
   * @param {*} _options 一些配置
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    // unifyObjectStyle 方法对 commit 多种形式传参 进行处理
    // commit 的载荷形式和对象形式的底层处理
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options) 

    const mutation = { type, payload }

    // 根据 type 去查找对应的 mutation
    const entry = this._mutations[type]
    // 没查到 报错提示
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }

    // 使用了 this._withCommit 的方法提交 mutation
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    // 遍历 this._subscribers，调用回调函数，并把 mutation 和当前的根 state 作为参数传入
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
}
```

`this.commmit()` 接收mutation的类型和外部参数，在 `commmit` 的实现中通过 `this._mutations[type]` 去匹配到对应的 `mutation` 函数，然后调用。

#### 4. actions函数中`context对象`，为什么不是store实例本身？
#### 5. 为什么在`actions函数`里可以调用 `dispatch` 或者 `commit`？

actions的使用：
```javascript
actions: {
    getTree(context) {
        getDepTree().then(res => {
            context.commit('updateTree', res.data)
        })
    }
}
```

在action的初始化函数中有这样一段代码：

```javascript
/**
 * 注册actions
 * @param {*} store 全局store
 * @param {*} type action 类型
 * @param {*} handler action 函数
 * @param {*} local 当前的module
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {

    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    // store._devtoolHook 是在store constructor的时候执行 赋值的
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

```
很明显context对象是指定的，并不是store实例， `
const {dispatch, commit, getters, state, rootGetters,rootState } = context` 

context对象上挂载了：
- dispatch, 当前模块上的dispatch函数
- commit, 当前模块上的commit函数
- getters, 当前模块上的getters
- state, 当前模块上的state
- rootGetters, 根模块上的getters
- rootState 根模块上的state

#### 6. 通过 `this.$store.getters.xx`，是如何可以访问到getter函数的执行结果的？

在Vuex源码的Store实例的实现中有这样一个方法 `resetStoreVM`:

```javascript
function resetStoreVM (store, state, hot) {
    const oldVm = store._vm

    // bind store public getters
    store.getters = {}
    const wrappedGetters = store._wrappedGetters
    const computed = {}
    Object.keys(wrappedGetters).forEach(key => {
        const fn = wrappedGetters[key]
        // use computed to leverage its lazy-caching mechanism
        computed[key] = () => fn(store)
        Object.defineProperty(store.getters, key, {
        get: () => store._vm[key]
        })
    })
    
    // ...
    
    store._vm = new Vue({
        data: { state },
        computed
    })
    
    // ...
}
```
遍历 `store._wrappedGetters` 对象，在遍历过程中拿到每个 `getter` 的包装函数，并把这个包装函数执行的结果用 `computed` 临时保存。

然后实例化了一个 `Vue实例`，把上面的 `computed` 作为计算属性传入，把 `状态树state` 作为 `data` 传入，这样就完成了注册。

我们就可以在组件中访问 `this.$store.getters.xxgetter`了，相当于访问了 `store._vm[xxgetter]`，也就是在访问 `computed[xxgetter]`，这样就访问到 `xxgetter` 的回调函数了。 


## 参考

- [Flux 架构入门教程](http://www.ruanyifeng.com/blog/2016/01/flux.html)
- [Vuex官网](https://vuex.vuejs.org/zh/)
