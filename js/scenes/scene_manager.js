// 场景管理器 - 负责场景切换、事件分发、循环渲染
import LobbyScene from './lobby_scene';
import RoomScene from './room_scene';
import { SCENES } from '../databus';

let instance;

export default class SceneManager {
  current = null;  // 当前场景实例
  scenes = {};     // 场景实例缓存

  constructor() {
    if (instance) return instance;
    instance = this;
  }

  // 初始化所有场景
  init() {
    this.scenes[SCENES.LOBBY] = new LobbyScene();
    this.scenes[SCENES.ROOM] = new RoomScene();
    this.switchTo(SCENES.LOBBY);
  }

  // 切换到指定场景
  switchTo(name) {
    if (this.current && this.current.onExit) {
      this.current.onExit();
    }
    const target = this.scenes[name];
    if (!target) {
      console.warn('未知场景:', name);
      return;
    }
    GameGlobal.databus.scene = name;
    this.current = target;
    if (this.current.onEnter) {
      this.current.onEnter();
    }
  }

  // 渲染当前场景
  render(ctx) {
    if (this.current && this.current.render) {
      this.current.render(ctx);
    }
  }

  // 更新当前场景
  update() {
    if (this.current && this.current.update) {
      this.current.update();
    }
  }

  // 触摸事件分发
  onTouchStart(e) {
    if (this.current && this.current.onTouchStart) {
      this.current.onTouchStart(e);
    }
  }
  onTouchMove(e) {
    if (this.current && this.current.onTouchMove) {
      this.current.onTouchMove(e);
    }
  }
  onTouchEnd(e) {
    if (this.current && this.current.onTouchEnd) {
      this.current.onTouchEnd(e);
    }
  }
}
