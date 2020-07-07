const target = typeof window !== 'undefined'
  ? window
  : typeof global !== 'undefined'
    ? global
    : {}

// window.__VUE_DEVTOOLS_GLOBAL_HOOK__ 返回一个对象 方便数据状态追踪 可以理解成 vue_devtools的底层实现是调用Vue的emit\on等 变更状态的
// {
//   Vue: ƒ Un(e)
//   on: ƒ on(t,n)
//   once: ƒ once(t,n)
//   off: ƒ off(t,n)
//   emit: ƒ emit(t)
// }
const devtoolHook = target.__VUE_DEVTOOLS_GLOBAL_HOOK__

export default function devtoolPlugin (store) {
  if (!devtoolHook) return

  store._devtoolHook = devtoolHook

  // 派发vuex初始化事件
  devtoolHook.emit('vuex:init', store)

  // 状态时光穿行机 把开发者工具的上状态树 替换store的状态树
  devtoolHook.on('vuex:travel-to-state', targetState => {
    store.replaceState(targetState)
  })

  // 调用vuex的subscribe方法 订阅 store 的 state 的变化
  // 当 store 的 mutation 提交了 state 的变化， 
  // 会触发回调函数—— 通过 devtoolHook 派发一个 Vuex mutation 的事件， 
  // mutation 和 rootState 作为参数， 这样开发者工具就可以观测到 Vuex state 的实时变化，
  store.subscribe((mutation, state) => {
    devtoolHook.emit('vuex:mutation', mutation, state)
  })
}
