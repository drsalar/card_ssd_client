// 基于 tinyemitter 的全局事件总线
import TinyEmitter from '../libs/tinyemitter';

// 全局共享一个事件总线实例，用于跨场景/组件通信
const eventBus = new TinyEmitter();

export default eventBus;
