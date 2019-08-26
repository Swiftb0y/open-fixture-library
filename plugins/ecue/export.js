const xmlbuilder = require(`xmlbuilder`);

const {
  CoarseChannel,
  FineChannel,
  NullChannel,
  Physical,
  SwitchingChannel
} = require(`../../lib/model.js`);

module.exports.version = `0.3.0`;

/**
 * @param {array.<Fixture>} fixtures An array of Fixture objects.
 * @param {object} options Global options, including:
 * @param {string} options.baseDir Absolute path to OFL's root directory.
 * @param {Date} options.date The current time.
 * @param {string|undefined} options.displayedPluginVersion Replacement for module.exports.version if the plugin version is used in export.
 * @returns {Promise.<array.<object>, Error>} The generated files.
*/
module.exports.export = async function exportECue(fixtures, options) {
  const timestamp = dateToString(options.date);

  const manufacturers = {};
  for (const fix of fixtures) {
    const man = fix.manufacturer.key;
    if (!(man in manufacturers)) {
      manufacturers[man] = {
        data: fix.manufacturer,
        fixtures: []
      };
    }
    manufacturers[man].fixtures.push(fix);
  }

  const xml = xmlbuilder.create(
    {
      Document: {
        '@Owner': `user`,
        '@TypeVersion': 2,
        '@SaveTimeStamp': timestamp
      }
    },
    {
      version: `1.0`,
      encoding: `UTF-8`,
      standalone: true
    }
  );

  const xmlLibrary = xml.element({
    Library: {}
  });
  const xmlFixtures = xmlLibrary.element({
    Fixtures: {}
  });
  const xmlTiles = xmlLibrary.element({
    Tiles: {}
  });

  for (const man of Object.keys(manufacturers)) {
    const manAttributes = {
      '_CreationDate': timestamp,
      '_ModifiedDate': timestamp,
      'Name': manufacturers[man].data.name,
      'Comment': manufacturers[man].data.comment,
      'Web': manufacturers[man].data.website || ``
    };
    xmlTiles.element(`Manufacturer`, manAttributes);

    const xmlManFixtures = xmlFixtures.element(`Manufacturer`, manAttributes);
    for (const fixture of manufacturers[man].fixtures) {
      addFixture(xmlManFixtures, fixture);
    }
  }

  return [{
    name: `UserLibrary.xml`,
    content: xml.end({
      pretty: true,
      indent: `    `
    }),
    mimetype: `application/xml`,
    fixtures: fixtures
  }];
};

/**
 * @param {object} xmlMan The xmlbuilder <Manufacturer> object.
 * @param {Fixture} fixture The OFL fixture object.
 */
function addFixture(xmlMan, fixture) {
  const fixCreationDate = dateToString(fixture.meta.createDate);
  const fixModifiedDate = dateToString(fixture.meta.lastModifyDate);

  for (const mode of fixture.modes) {
    const physical = mode.physical || new Physical({});

    const xmlFixture = xmlMan.element(`Fixture`, {
      '_CreationDate': fixCreationDate,
      '_ModifiedDate': fixModifiedDate,
      'Name': fixture.name + (fixture.modes.length > 1 ? ` (${mode.shortName} mode)` : ``),
      'NameShort': fixture.shortName + (fixture.modes.length > 1 ? `-${mode.shortName}` : ``),
      'Comment': getFixtureComment(fixture),
      'AllocateDmxChannels': mode.channels.length,
      'Weight': physical.weight || 0,
      'Power': physical.power || 0,
      'DimWidth': physical.width || 10,
      'DimHeight': physical.height || 10,
      'DimDepth': physical.depth || 10
    });

    handleMode(xmlFixture, mode);
  }
}

/**
 * @param {object} xmlFixture The xmlbuilder <Fixture> object.
 * @param {Mode} mode The OFL mode object.
 */
function handleMode(xmlFixture, mode) {
  let viewPosCount = 1;
  for (let dmxCount = 0; dmxCount < mode.channels.length; dmxCount++) {
    let channel = mode.channels[dmxCount];

    // skip unused channels
    if (channel instanceof NullChannel) {
      continue;
    }

    const channelName = channel.name;

    // ecue doesn't support switching channels, so we just use the default channel's data
    if (channel instanceof SwitchingChannel) {
      channel = channel.defaultChannel;
    }

    let fineChannelKey = null;
    if (channel instanceof FineChannel) {
      if (channel.resolution === CoarseChannel.RESOLUTION_16BIT) {
        // ignore this channel, we handle it together with its coarse channel
        continue;
      }

      // just pretend its a single channel and use coarse channel's data
      fineChannelKey = channel.key;
      channel = channel.coarseChannel;
    }

    const dmxByte0 = dmxCount + 1;
    let dmxByte1 = 0;
    let resolution = CoarseChannel.RESOLUTION_8BIT;

    if (fineChannelKey === null && channel.fineChannelAliases.length > 0) {
      dmxByte1 = mode.getChannelIndex(channel.fineChannelAliases[0], `defaultOnly`) + 1;
      resolution = Math.min(CoarseChannel.RESOLUTION_16BIT, channel.getResolutionInMode(mode, `defaultOnly`));
    }

    const defaultValue = channel.getDefaultValueWithResolution(resolution);
    const highlightValue = channel.getHighlightValueWithResolution(resolution);

    const xmlChannel = xmlFixture.element(getChannelType(channel), {
      'Name': channelName,
      'DefaultValue': defaultValue,
      'Highlight': highlightValue,
      'Deflection': 0,
      'DmxByte0': dmxByte0,
      'DmxByte1': dmxByte1,
      'Constant': channel.isConstant ? 1 : 0,
      'Crossfade': channel.canCrossfade ? 1 : 0,
      'Invert': channel.isInverted ? 1 : 0,
      'Precedence': channel.precedence,
      'ClassicPos': viewPosCount
    });

    if (fineChannelKey === null) {
      addCapabilities(xmlChannel, channel, resolution);
    }

    viewPosCount++;
  }
}

/**
 * @param {Fixture} fixture The OFL fixture object.
 * @returns {string} The comment to use in the exported fixture.
 */
function getFixtureComment(fixture) {
  const generatedString = `generated by the Open Fixture Library – ${fixture.url}`;
  if (fixture.hasComment) {
    return `${fixture.comment} (${generatedString})`;
  }
  return generatedString;
}

/**
 * @param {CoarseChannel} channel The OFL channel object.
 * @returns {string} The e:cue channel type for the channel.
 */
function getChannelType(channel) {
  switch (channel.type) {
    case `Multi-Color`:
    case `Single Color`:
    case `Color Temperature`:
      return `ChannelColor`;

    case `Iris`:
    case `Zoom`:
    case `Shutter`:
    case `Strobe`:
    case `Gobo`:
    case `Prism`:
    case `Effect`:
    case `Speed`:
    case `Maintenance`:
    case `NoFunction`:
      return `ChannelBeam`;

    case `Pan`:
    case `Tilt`:
    case `Focus`:
      return `ChannelFocus`;

    case `Intensity`:
    case `Fog`:
    default:
      return `ChannelIntensity`;
  }
}

/**
 * @param {object} xmlChannel The xmlbuilder <Channel*> object.
 * @param {CoarseChannel} channel The OFL channel object.
 * @param {number} resolution The resolution of the channel in the current mode.
 */
function addCapabilities(xmlChannel, channel, resolution) {
  for (const cap of channel.capabilities) {
    const dmxRange = cap.getDmxRangeWithResolution(resolution);
    xmlChannel.element(`Range`, {
      'Name': cap.name,
      'Start': dmxRange.start,
      'End': dmxRange.end,
      'AutoMenu': cap.menuClick === `hidden` ? 0 : 1,
      'Centre': cap.menuClick === `center` ? 1 : 0
    });
  }
}

/**
 * @param {Date} date The date to format.
 * @returns {string} The date in YYYY-MM-DD#HH:mm:ss format.
 */
function dateToString(date) {
  return date.toISOString().replace(/T/, `#`).replace(/\..+/, ``);
}
