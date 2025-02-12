import AbstractChannel from './AbstractChannel.js';
/** @ignore @typedef {import('./Fixture.js').default} Fixture */
import Range from './Range.js';

/**
 * Represents a channel that switches its behavior depending on trigger channel's value.
 * The different behaviors are implemented as different {@link CoarseChannel}s or {@link FineChannel}s.
 * @extends AbstractChannel
 */
class SwitchingChannel extends AbstractChannel {
  /**
   * Creates a new SwitchingChannel instance.
   * @param {String} alias The unique switching channel alias as defined in the trigger channel's `switchChannels` properties.
   * @param {AbstractChannel} triggerChannel The channel whose DMX value this channel depends on.
   */
  constructor(alias, triggerChannel) {
    super(alias);
    this._triggerChannel = triggerChannel;
    this._cache = {};
  }

  /**
   * @returns {AbstractChannel} The channel whose DMX value this switching channel depends on.
   */
  get triggerChannel() {
    return this._triggerChannel;
  }

  /**
   * Overrides [`AbstractChannel.fixture`]{@link AbstractChannel#fixture}.
   * @returns {Fixture} The fixture in which this channel is used.
   */
  get fixture() {
    return this.triggerChannel.fixture;
  }

  /**
   * @typedef {Object} TriggerCapability
   * @property {Range} dmxRange
   * @property {String} switchTo
   */

  /**
   * @returns {Array.<TriggerCapability>} The trigger channel's capabilities in a compact form to only include the DMX range and which channel should be switched to. DMX values are given in the trigger channel's highest possible resolution.
   */
  get triggerCapabilities() {
    if (!(`triggerCapabilities` in this._cache)) {
      this._cache.triggerCapabilities = this.triggerChannel.capabilities.map(
        cap => ({
          dmxRange: cap.dmxRange,
          switchTo: cap.switchChannels[this.key]
        })
      );
    }

    return this._cache.triggerCapabilities;
  }

  /**
   * @returns {Object.<String, Array.<Range>>} Keys of channels that can be switched to pointing to an array of DMX values the trigger channel must be set to to active the channel. DMX values are given in the trigger channel's highest possible resolution.
   */
  get triggerRanges() {
    if (!(`triggerRanges` in this._cache)) {
      const ranges = {};

      // group ranges by switchTo
      for (const cap of this.triggerCapabilities) {
        if (!(cap.switchTo in ranges)) {
          ranges[cap.switchTo] = [];
        }
        ranges[cap.switchTo].push(cap.dmxRange);
      }

      // merge each group of ranges
      for (const ch of Object.keys(ranges)) {
        ranges[ch] = Range.getMergedRanges(ranges[ch]);
      }

      this._cache.triggerRanges = ranges;
    }

    return this._cache.triggerRanges;
  }

  /**
   * @returns {String} The key of the channel that is activated when the trigger channel is set to its default value.
   */
  get defaultChannelKey() {
    if (!(`defaultChannelKey` in this._cache)) {
      this._cache.defaultChannelKey = this.triggerCapabilities.find(
        cap => cap.dmxRange.contains(this.triggerChannel.defaultValue)
      ).switchTo;
    }

    return this._cache.defaultChannelKey;
  }

  /**
   * @returns {AbstractChannel} The channel that is activated when the trigger channel is set to its default value.
   */
  get defaultChannel() {
    if (!(`defaultChannel` in this._cache)) {
      this._cache.defaultChannel = this.fixture.getChannelByKey(this.defaultChannelKey);
    }
    return this._cache.defaultChannel;
  }

  /**
   * @returns {Array.<String>} All channel keys this channel can be switched to.
   */
  get switchToChannelKeys() {
    if (!(`switchToChannelKeys` in this._cache)) {
      this._cache.switchToChannelKeys = this.triggerCapabilities
        .map(cap => cap.switchTo)
        .filter((chKey, index, arr) => arr.indexOf(chKey) === index); // filter duplicates
    }

    return this._cache.switchToChannelKeys;
  }

  /**
   * @returns {Array.<AbstractChannel>} All channels this channel can be switched to.
   */
  get switchToChannels() {
    if (!(`switchToChannels` in this._cache)) {
      this._cache.switchToChannels = this.switchToChannelKeys.map(
        chKey => this.fixture.getChannelByKey(chKey)
      );
    }

    return this._cache.switchToChannels;
  }

  /**
   * @typedef {'keyOnly'|'defaultOnly'|'switchedOnly'|'all'} SwitchingChannelBehavior
   */

  /**
   * @param {String} chKey The channel key to search for.
   * @param {SwitchingChannelBehavior} [switchingChannelBehavior='all'] Define which channels to include in the search.
   * @returns {Boolean} Whether this SwitchingChannel contains the given channel key.
   */
  usesChannelKey(chKey, switchingChannelBehavior = `all`) {
    if (switchingChannelBehavior === `keyOnly`) {
      return this.key === chKey;
    }

    if (switchingChannelBehavior === `defaultOnly`) {
      return this.defaultChannel.key === chKey;
    }

    if (switchingChannelBehavior === `switchedOnly`) {
      return this.switchToChannelKeys.includes(chKey);
    }

    return this.switchToChannelKeys.includes(chKey) || this.key === chKey;
  }

  /**
   * @returns {Boolean} True if help is needed in one of the switched channels, false otherwise.
   */
  get isHelpWanted() {
    if (!(`isHelpWanted` in this._cache)) {
      this._cache.isHelpWanted = this.switchToChannels.some(
        channel => channel.isHelpWanted
      );
    }

    return this._cache.isHelpWanted;
  }
}

export default SwitchingChannel;
