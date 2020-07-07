import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install
/**
 * Store 是一个类
 * 接收一个参数：options对象
 */
export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731

    // 保证Vue存在
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      // 当前浏览器有Promise 因为Vuex的实现是基于Promise
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      // Store必须实例化
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    // 利用 es6 的结构赋值拿到 options 里的 state，plugins 和 strict
    const {
      plugins = [], // plugins 表示应用的插件 是个数据可以 同时使用多个插件
      strict = false // strict 表示是否开启严格模式 默认关闭 防止性能消耗
    } = options

    // store internal state
    this._committing = false //  标志一个提交状态，作用是保证对 Vuex 中 state 的修改只能在 mutation 的回调函数中，而不能在外部随意修改 state。
    this._actions = Object.create(null) // 用来存储用户定义的所有的 actions
    this._actionSubscribers = [] 
    this._mutations = Object.create(null) // 用来存储用户定义所有的 mutatins
    this._wrappedGetters = Object.create(null) // 来存储用户定义的所有 getters
    this._modules = new ModuleCollection(options) // 初始化module 用来存储所有的运行时的 modules 
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = [] // 用来存储所有对 mutation 变化的订阅者
    this._watcherVM = new Vue() // 是一个 Vue 对象的实例，主要是利用 Vue 实例方法 $watch 来观测变化的
    this._makeLocalGettersCache = Object.create(null) // getter缓存 

    // bind commit and dispatch to self
    // 把Store类的 dispatch 和 commit 的方法的this 指针指向当前 store 的实例上
    const store = this
    const { dispatch, commit } = this
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    // 是否开启严格模式
    // 在严格模式下会观测所有的 state 的变化，建议在开发环境时开启严格模式
    // 线上环境要关闭严格模式，否则会有一定的性能开销。
    this.strict = strict

    // 根state
    const state = this._modules.root.state 

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 初始化模块 模块注册和安装
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // store._vm，观测 state 和 getters 的变化
    resetStoreVM(this, state) // 对store里结合vue进行响应式

    // apply plugins
    // 应用插件
    plugins.forEach(plugin => plugin(this))

    // devtool配置的两种方式 在vue根实例上添加属性devtools: true 或者Vue.config.devtools=true
    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this) // 此处结合vue devtool的实现思考
    }
  }

  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  /**
   * 
   * @param {*} _type mutation 的类型
   * @param {*} _payload 额外的参数
   * @param {*} _options 一些配置
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    // 对 commit 多种形式传参 进行处理
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


    // _subscribers 存储了所有的mutations
    // 遍历 this._subscribers，调用回调函数，并把 mutation 和当前的根 state 作为参数传入
    // 把mutation 和当前的根 state 订阅，成为响应式
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

  /**
   * 
   * @param {*} _type 
   * @param {*} _payload 
   */
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      this._actionSubscribers
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }
    
    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    return result.then(res => {
      try {
        this._actionSubscribers
          .filter(sub => sub.after)
          .forEach(sub => sub.after(action, this.state))
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[vuex] error in after action subscribers: `)
          console.error(e)
        }
      }
      return res
    })
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  subscribeAction (fn) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers)
  }

  /**
   * watch 响应式的监听 getter 方法的返回值， 当值改变时调用回调。
   * @param {*} getter 
   * @param {*} cb 
   * @param {*} options 
   */
  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      // 断言getter必须是一个函数
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    // getter 接收store的state 和 getters作为参数，当值改变的时候则调用cb函数
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  /**
   * 注册动态模块 异步加载业务的时候 可以通过该API动态注入模块
   * @param {*} path 
   * @param {*} rawModule 
   * @param {*} options 
   */
  registerModule (path, rawModule, options = {}) {
    // 保证path为数组
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    // 和初始化store类似，再调用installModule 和 resetStoreVm 方法安装一遍动态注入的 module
    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state) // 重置store 和更新 getters
  }

  // 注销一个动态模块 有始有终
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    // 删掉以path点连接的key对应的模块。
    this._modules.unregister(path)
    // 通过_withCommit删除 state的变更都会通过_withCommit
    this._withCommit(() => {
      // 把当前摸的state 从父state上删除
      const parentState = getNestedState(this.state, path.slice(0, -1))
      // 删除父state上的 path 当前模块的state失去响应式并能触发更新视图
      Vue.delete(parentState, path[path.length - 1])
    })

    // 重置store
    resetStore(this)
  }

  // 热加载新的 action 和 mutation
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    // 重置store
    resetStore(this, true)
  }

  /**
   * 检测state的更改
   * Vuex中所有对state的修改都会调用 _withCommit函数的包装，保证在同步修改 state 的过程中this._committing 的值始终为true。
   * 当我们检测到 state 变化的时候，如果 this._committing 不为 true，则能查到这个状态修改有问题
   * @param {*} fn 
   */
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

/**
 * 保存mutation函数 并返回一个函数
 * 当这个函数被调用的时候 就解除当前函数对 store 的 mutation 的监听
 * @param {*} fn mutation函数
 * @param {*} subs 
 */
function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

/**
 * 重置store对象 重置actions mutations getters  
 * @param {*} store 
 * @param {*} hot 
 */
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  // 重新初始化module
  installModule(store, state, [], store._modules.root, true)
  // reset vm 
  // 重置 Store 的 _vm 对象
  resetStoreVM(store, state, hot)
}

/**
 * 充值了_vm私有对象
 * @param {*} store store实例
 * @param {*} state 模块state
 * @param {*} hot 
 */
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null)
  // getter初始化的时候挂载上的
  const wrappedGetters = store._wrappedGetters 
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computed[key] = partial(fn, store)
    // 将getter挂载到store.getters上
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true

  // _vm 保存了状态树 $$state 和computed
  // 用计算属性的方式存储了 store 的 getters, 所以getters具备了computed的缓存特性
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new 
  // 严格模式做了什么处理呢
  if (store.strict) {
    enableStrictMode(store)
  }

  // 重置 null 并销毁旧的 Vue 的实例
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

/**
 * installModule(this, state, [], this._modules.root)
 * @param {*} store  当前 Store 实例
 * @param {*} rootState  根 state
 * @param {*} path 当前嵌套模块的路径数组
 * @param {*} module 当前安装的模块
 * @param {*} hot  当动态改变 modules 或者热更新的时候为 true
 */
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  // 当不为根 且非热更新的情况 todo
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]

    store._withCommit(() => {
      if (process.env.NODE_ENV !== 'production') {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }

      // 通过vue的 $set, 把当前模块的 state 添加到 parentState 中
      Vue.set(parentState, moduleName, module.state)
    })
  }

  const local = module.context = makeLocalContext(store, namespace, path)

  // 分别是对 mutations、actions、getters 进行（register）注册， 原理使用的 module的 forEachValue
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 如果有 module 的话 递归installModule去安装子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  // 必须要懒获取 getters 和 state 因为他们变更带来响应式更新 消耗性能
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

/**
 * 设置命名空间才会调用的方法
 * getter配置和命名空间做匹配 
 * @param {*} store 
 * @param {*} namespace 
 * @return {*} Object
 */
function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type
      const localType = type.slice(splitPos)

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

/**
 * 注册mutation 作用同步修改当前模块的 state
 * @param {*} store // Store实例
 * @param {*} type // mutation 的 key
 * @param {*} handler // mutation 执行的函数
 * @param {*} local // 当前模块
 */
function registerMutation (store, type, handler, local) {
  // mutation 数组
  const entry = store._mutations[type] || (store._mutations[type] = []) 
  // 包装handler 放入到 entry
  entry.push(function wrappedMutationHandler (payload) { 
    // 改变handle的this指向为Store实例，local.state 为当前模块的state，payload 为额外参数
    handler.call(store, local.state, payload)
  })
}

/**
 * 注册actions 最后返回一个promise对象
 * @param {*} store 全局store
 * @param {*} type action 类型
 * @param {*} handler action 函数
 * @param {*} local 当前的module
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {

    // 看这里就清楚了 为什么在action里可以调用 dispatch 或者 commit了 😄
    // 还记得context吗？ const {dispatch, commit, getters, state, rootGetters,rootState } = context
    //
    // actions: {
    //   getTree({commit}) {
    //       getDepTree().then(res => {
    //           commit('updateTree', res.data)
    //       })
    //   }
    // }

    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)

    // 如果不是promise 就进行promise.resolve 将res封装为promise对象
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }

    // store._devtoolHook 是在store constructor的时候执行 赋值的
    // 当devtool开启了 就能捕获 promise 的过程 否则返回res
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

/**
 * 注册getter
 * @param {*} store 全局store
 * @param {*} type getter 类型
 * @param {*} rawGetter getter 函数
 * @param {*} local 当前module
 */
function registerGetter (store, type, rawGetter, local) {
  // getter的type不允许重复
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  // getters 可以接收四个参数
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 严格模式下 才会执行的方法 用于监听所有的 state 的变化
// 监测 store._vm.state 的变化
// $watch  deep深度监听 sync同步监听处理
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      // 添加了一条断言 如果store._committing为真就报错 也就是必须得是mutation修改state 
      // Vuex 中对 state 的修改只能在 mutation 的回调函数里。
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

/**
 * 根据path 查找出当前模块的父模块的 state
 * @param {*} state 
 * @param {*} path 数组【rootpath, childpath】
 */
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

/**
 * 
 * @param {*} type 类型
 * @param {*} payload 额外参数
 * @param {*} options 
 */
function unifyObjectStyle (type, payload, options) {
  // 对 type 为 object 的情况进行处理 保证最后type为 mutation类型，payload为额外参数payload
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

/**
 * install 方法接收一个参数 vue实例
 * @param {*} _Vue 
 */
export function install (_Vue) {
  // 防止对Vuex重复安装
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }

  // vuex 插件全局保留Vue
  Vue = _Vue
  // 应用mixin
  applyMixin(Vue)
}
