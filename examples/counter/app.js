import 'babel-polyfill'
import Vue from 'vue'
import Counter from './Counter.vue'
import store from './store.js'

new Vue({
  el: '#app',
  devtools: true,
  store,
  render: h => h(Counter)
})
