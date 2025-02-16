<template>
  <div>
    <script type="application/ld+json" v-html="organizationStructuredData" />
    <script type="application/ld+json" v-html="itemListStructuredData" />

    <h1>{{ manufacturer.name }} fixtures</h1>

    <div v-if="`website` in manufacturer || `rdmId` in manufacturer" class="grid-3">
      <a
        v-if="`website` in manufacturer"
        :href="manufacturer.website"
        class="card slim blue dark">
        <OflSvg name="web" class="left" />
        <span>Manufacturer website</span>
      </a>
      <a
        v-if="`rdmId` in manufacturer"
        :href="`http://rdm.openlighting.org/manufacturer/display?manufacturer=${manufacturer.rdmId}`"
        rel="nofollow"
        class="card slim">
        <OflSvg name="ola" class="left" />
        <span>Open Lighting RDM database</span>
      </a>
    </div>

    <p v-if="`comment` in manufacturer" class="comment" style="white-space: pre-wrap;">{{ manufacturer.comment }}</p>

    <div class="card">
      <ul class="list fixtures">
        <li v-for="fixture in fixtures" :key="fixture.key">
          <NuxtLink
            :to="fixture.link"
            :style="{ borderLeftColor: manufacturer.color }"
            class="manufacturer-color">
            <span class="name">{{ fixture.name }}</span>
            <OflSvg
              v-for="cat in fixture.categories"
              :key="cat"
              :name="cat"
              type="fixture"
              class="right inactive" />
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import packageJson from '../../../package.json';
import register from '../../../fixtures/register.json';
import manufacturers from '../../../fixtures/manufacturers.json';

export default {
  validate({ params }) {
    return params.manufacturerKey in manufacturers && params.manufacturerKey !== `$schema`;
  },
  async asyncData({ params }) {
    const manKey = params.manufacturerKey;
    const manufacturer = manufacturers[manKey];

    const fixtures = (register.manufacturers[manKey] || []).map(
      fixKey => ({
        key: fixKey,
        link: `/${manKey}/${fixKey}`,
        name: register.filesystem[`${manKey}/${fixKey}`].name,
        categories: Object.keys(register.categories).filter(
          cat => register.categories[cat].includes(`${manKey}/${fixKey}`)
        )
      })
    );

    const organizationStructuredData = {
      '@context': `http://schema.org`,
      '@type': `Organization`,
      'name': manufacturer.name,
      'brand': manufacturer.name
    };

    if (`website` in manufacturer) {
      organizationStructuredData.sameAs = manufacturer.website;
    }

    const itemListStructuredData = {
      '@context': `http://schema.org`,
      '@type': `ItemList`,
      'itemListElement': fixtures.map((fix, index) => ({
        '@type': `ListItem`,
        'position': index + 1,
        'url': `${packageJson.homepage}${fix.link}`
      }))
    };

    return {
      manufacturer: Object.assign({}, manufacturer, {
        color: register.colors[manKey]
      }),
      fixtures,
      organizationStructuredData,
      itemListStructuredData
    };
  },
  head() {
    const title = this.manufacturer.name;

    return {
      title,
      meta: [
        {
          hid: `title`,
          content: title
        }
      ]
    };
  }
};
</script>
