
// store.js文件和helpers.js 为核心两个文件
import { Store, install } from './store'
import { mapState, mapMutations, mapGetters, mapActions, createNamespacedHelpers } from './helpers'

// vuex 对外暴露的方法
/**
 * install Vuex初始化 当Vue.use(Vuex)的时候调用
 * Store Vuex实例化 Vuex.Store(options)的时候调用 
 * 
 * mapState 是Vuex提供的state的简化写法的api
 * mapMutations 是Vuex提供的mutations的简化写法的api
 * mapGetters 是Vuex提供的gettes的简化写法的api
 * mapActions 是Vuex提供的actions的简化写法的api
 * 
 * createNamespacedHelpers 对store分模块的时候 该函数可以返回当前命名模块的四个map
 */
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
