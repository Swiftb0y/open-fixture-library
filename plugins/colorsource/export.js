// see https://github.com/standard-things/esm#getting-started
require = require(`esm`)(module); // eslint-disable-line no-global-assign
const uuidV5 = require(`uuid/v5`);

const {
  CoarseChannel,
  FineChannel,
  SwitchingChannel
} = require(`../../lib/model.js`);
const { scaleDmxValue } = require(`../../lib/scale-dmx-values.mjs`);

module.exports.name = `ColorSource`;
module.exports.version = `0.1.0`;

const EDITOR_VERSION = `1.1.1.9.0.4`;

const CHANNEL_TYPE_NO_FUNCTION = 0;
const CHANNEL_TYPE_INTENSITY = 1;
const CHANNEL_TYPE_POSITION = 2;
const CHANNEL_TYPE_MULTI_COLOR = 3;
const CHANNEL_TYPE_BEAM = 4;
const CHANNEL_TYPE_COLOR = 5;

const UUID_NAMESPACE = `0de81b51-02b2-45e3-b53c-578f9eb31b77`;

/**
 * @param {array.<Fixture>} fixtures An array of Fixture objects.
 * @param {object} options Global options, including:
 * @param {string} options.baseDir Absolute path to OFL's root directory.
 * @param {Date|null} options.date The current time.
 * @returns {Promise.<array.<object>, Error>} The generated files.
*/
module.exports.export = function exportColorSource(fixtures, options) {
  const exportJson = {
    date: options.date.toISOString().replace(/\.\d\d\dZ$/, `Z`),
    editorVersion: EDITOR_VERSION,
    personalities: []
  };

  fixtures.forEach(fixture => {
    const fixtureUuidNamespace = uuidV5(`${fixture.manufacturer.key}/${fixture.key}`, UUID_NAMESPACE);

    fixture.modes.forEach(mode => {
      const dcid = uuidV5(mode.name, fixtureUuidNamespace);
      const hasIntensity = mode.channels.some(ch => ch.type === `Intensity`);
      const parameters = getCSChannels(mode, hasIntensity);

      const fixtureJson = {
        dcid,
        colortable: dcid,
        commands: getCommands(mode),
        hasIntensity,
        manufacturerName: fixture.manufacturer.name,
        maxOffset: mode.channels.length - 1,
        modeName: mode.name,
        modelName: fixture.name,
        parameters
      };

      removeEmptyProperties(fixtureJson);

      exportJson.personalities.push(fixtureJson);
    });
  });

  return Promise.resolve([{
    name: `userlib.jlib`,
    content: JSON.stringify(exportJson, null, 2),
    mimetype: `application/json`,
    fixtures
  }]);
};

/**
 * @param {Mode} mode The personality's mode.
 * @returns {array.<object>} Array of ColorSource commands (like "Reset"), may be empty. The commands are generated by Maintenance capabilities with hold time set.
 */
function getCommands(mode) {
  const commands = [];
  mode.channels.forEach((channel, channelIndex) => {
    if (channel.capabilities) {
      channel.capabilities.forEach(cap => {
        if (cap.type === `Maintenance` && cap.hold) {
          commands.push({
            name: cap.comment,
            steps: [
              {
                actions: [{
                  dmx: channelIndex,
                  value: cap.getMenuClickDmxValueWithResolution(CoarseChannel.RESOLUTION_8BIT)
                }],
                wait: 0 // this is apparently the delay before this step is activated
              },
              {
                actions: [{
                  dmx: channelIndex,
                  value: -1
                }],
                wait: cap.hold.getBaseUnitEntity().number
              }
            ]
          });
        }
      });
    }
  });

  return commands;
}

/**
 * @param {Mode} mode The personality's mode.
 * @param {boolean} hasIntensity Whether the mode has an intensity channel. Should equal fixtureJson.hasIntensity
 * @returns {array.<object>} ColorSource channel objects of all mode channels.
 */
function getCSChannels(mode, hasIntensity) {
  return mode.channels.map((channel, channelIndex) => {
    const name = channel.name;

    if (channel instanceof SwitchingChannel) {
      channel = channel.defaultChannel;
    }

    const channelJson = {
      coarse: channelIndex,
      fadeWithIntensity: false,
      fine: null,
      highlight: 65535,
      home: 0,
      invert: false,
      name,
      ranges: [],
      size: 8,
      snap: false,
      type: getCSChannelType(channel)
    };

    if (channelJson.type === CHANNEL_TYPE_COLOR) {
      channelJson.name = channelJson.name.replace(/ /g, ``); // e.g. 'Warm White' -> 'WarmWhite'
    }

    if (channel instanceof FineChannel) {
      if (channel.resolution === CoarseChannel.RESOLUTION_16BIT) {
        // already handled by "fine" attribute of coarse channel
        return null;
      }

      channelJson.type = CHANNEL_TYPE_BEAM;
      channelJson.home = scaleDmxValue(channel.defaultValue, CoarseChannel.RESOLUTION_8BIT, CoarseChannel.RESOLUTION_16BIT);
    }
    else {
      addChannelDetails(channelJson, channel, channelIndex);
    }

    removeEmptyProperties(channelJson);

    return channelJson;
  }).filter(ch => ch !== null);

  /**
   * Adds detailed information to given channel JSON that only a CoarseChannel can provide.
   * @param {object} channelJson The ColorSource channel JSON to which the data is added.
   * @param {CoarseChannel} channel The channel whose information should be used.
   * @param {number} channelIndex The position of the channel in the current mode, starting from zero.
   */
  function addChannelDetails(channelJson, channel, channelIndex) {
    channelJson.fadeWithIntensity = channel.type === `Single Color` && hasIntensity;

    const fineChannel16bit = channel.fineChannels[0];
    const fineChannelIndex = mode.getChannelIndex(fineChannel16bit || {}, `default`);
    if (fineChannelIndex !== -1) {
      channelJson.fine = fineChannelIndex;
      channelJson.size = 16;
    }

    const channelResolution = channelJson.size / 8;
    channelJson.highlight = scaleDmxValue(channel.getHighlightValueWithResolution(channelResolution), channelResolution, CoarseChannel.RESOLUTION_16BIT);
    channelJson.home = scaleDmxValue(channel.getDefaultValueWithResolution(channelResolution), channelResolution, CoarseChannel.RESOLUTION_16BIT);
    channelJson.invert = channel.isInverted;
    channelJson.snap = !channel.canCrossfade;

    if (channelJson.type !== CHANNEL_TYPE_NO_FUNCTION) {
      channelJson.ranges = channel.capabilities.map(cap => {
        const dmxRange = cap.getDmxRangeWithResolution(CoarseChannel.RESOLUTION_8BIT);
        const capJson = {
          begin: dmxRange.start,
          default: cap.getMenuClickDmxValueWithResolution(CoarseChannel.RESOLUTION_8BIT),
          end: dmxRange.end,
          label: cap.name
        };

        if (cap.colors && cap.colors.allColors.length === 1) {
          const color = cap.colors.allColors[0]; // `#rrggbb`
          capJson.media = {
            r: parseInt(color.slice(1, 3), 16),
            g: parseInt(color.slice(3, 5), 16),
            b: parseInt(color.slice(5, 7), 16)
          };
        }

        return capJson;
      });
    }
  }
}

/**
 * @param {!AbstractChannel} channel The OFL channel of which the ColorSource channel type should be returned.
 * @returns {number} One of ColorSource's channel types as positive integer.
 */
function getCSChannelType(channel) {
  if (channel.type === `NoFunction`) {
    return CHANNEL_TYPE_NO_FUNCTION;
  }

  if (channel.type === `Single Color` || [`Hue`, `Saturation`].includes(channel.name)) {
    return CHANNEL_TYPE_COLOR;
  }

  if (channel.type === `Intensity`) {
    return CHANNEL_TYPE_INTENSITY;
  }

  if (isTypePosition()) {
    return CHANNEL_TYPE_POSITION;
  }

  if ([`Multi-Color`, `Color Temperature`].includes(channel.type)) {
    return CHANNEL_TYPE_MULTI_COLOR;
  }

  return CHANNEL_TYPE_BEAM;

  /**
   * @returns {boolean} Whether the channel is pan, tilt or pan/tilt speed.
   */
  function isTypePosition() {
    if ([`Pan`, `Tilt`].includes(channel.type)) {
      return true;
    }

    if (channel.capabilities && channel.capabilities.some(cap => cap.type === `PanTiltSpeed`)) {
      return true;
    }

    return false;
  }
}

/**
 * Removes null values and empty arrays from the given object.
 * This function is destructive, i.e. it mutates the given object.
 * @param {object} obj The object whose properties should be cleaned up.
 */
function removeEmptyProperties(obj) {
  Object.entries(obj).forEach(([key, value]) => {
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      delete obj[key];
    }
  });
}
