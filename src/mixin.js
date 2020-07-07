/**
 * mixin.js 默认导出一个匿名函数
 * @param {*} Vue 
 */
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  // 针对不同的版本做处理
  if (version >= 2) {
    // 版本大于等于2的全局混入 beforeCreate 
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   * Vuex 初始化钩子 
   * 若Vue实例上有属性store，将store挂载到当前实例的 this.$store
   * 否则通过parent找到 $store 将parent.$store复制给 this.$store
   * 这样就可以 让全局的组件上都挂载了$store 类似与vue-router的$router的实现
   */
  function vuexInit () {
    const options = this.$options
    // store injection
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
