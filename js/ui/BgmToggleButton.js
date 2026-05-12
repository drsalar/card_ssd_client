import Button from './Button';

const MUSIC_ICON = '♫';
const ENABLED_COLOR = '#43a047';
const DISABLED_COLOR = '#d84315';

export default class BgmToggleButton {
  constructor(opts = {}) {
    this.button = new Button({
      x: opts.x || 12,
      y: opts.y || 84,
      width: opts.width || 72,
      height: opts.height || 28,
      text: '',
      fontSize: opts.fontSize || 13,
      radius: opts.radius || 14,
      onClick: () => this._toggle(),
    });
    this._sync();
  }

  setPosition(x, y) {
    this.button.x = x;
    this.button.y = y;
    this._sync();
  }

  render(ctx) {
    this._sync();
    this.button.render(ctx);
  }

  handleTouch(x, y) {
    return this.button.handleTouch(x, y);
  }

  _toggle() {
    if (GameGlobal.music && typeof GameGlobal.music.toggleBgm === 'function') {
      GameGlobal.music.toggleBgm();
    }
    this._sync();
  }

  _sync() {
    const enabled = !GameGlobal.music || GameGlobal.music.isBgmEnabled();
    this.button.text = `${MUSIC_ICON} ${enabled ? '开' : '关'}`;
    this.button.bgColor = enabled ? ENABLED_COLOR : DISABLED_COLOR;
  }
}
