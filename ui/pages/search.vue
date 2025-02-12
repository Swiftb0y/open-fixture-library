<template>
  <div class="search">
    <h1 v-if="searchFor">Search <em>{{ searchFor }}</em></h1>
    <h1 v-else>Search</h1>

    <form class="filter" action="/search" @submit.prevent="onSubmit">
      <LabeledInput label="Search query">
        <input v-model="searchQuery" type="search" name="q">
      </LabeledInput>

      <ConditionalDetails :open="detailsInitiallyOpen">
        <template slot="summary">Filter results</template>

        <select v-model="manufacturersQuery" name="manufacturers" multiple>
          <option
            :selected="manufacturersQuery.length === 0"
            value="">Filter by manufacturer</option>

          <option
            v-for="man in manufacturers"
            :key="man.key"
            :selected="manufacturersQuery.includes(man.key)"
            :value="man.key">{{ man.name }}</option>
        </select>

        <select v-model="categoriesQuery" name="categories" multiple>
          <option
            :selected="categoriesQuery.length === 0"
            value="">Filter by category</option>

          <option
            v-for="cat in categories"
            :key="cat"
            :selected="categoriesQuery.includes(cat)"
            :value="cat">{{ cat }}</option>
        </select>
      </ConditionalDetails>

      <button :disabled="searchQuery === `` && isBrowser" type="submit" class="primary">Search</button>
    </form>

    <div class="search-results">
      <div v-if="!searchFor" class="card">
        Please enter a search query in the form above.
      </div>

      <div v-else-if="loading" class="card">
        Loading…
      </div>

      <div v-else-if="results.length > 0" class="card">
        <ul class="list fixtures">
          <li
            v-for="fixture in fixtureResults"
            :key="fixture.key">
            <NuxtLink
              :to="`/${fixture.key}`"
              :style="{ borderLeftColor: fixture.color }"
              class="manufacturer-color">
              <span class="name">{{ fixture.name }}</span>
            </NuxtLink>
          </li>
        </ul>
      </div>

      <div v-else class="card">
        Your search for <em>{{ searchFor }}</em> did not match any fixtures. Try using another query or browse by <NuxtLink to="/manufacturers">manufacturer</NuxtLink> or <NuxtLink to="/categories">category</NuxtLink>.
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.search-results {
  margin-top: 2rem;
}

.search /deep/ select[multiple] {
  margin-right: 1ex;
}

.search /deep/ details {
  margin: 1rem 0;
}
</style>

<script>
import register from '../../fixtures/register.json';
import manufacturers from '../../fixtures/manufacturers.json';

import ConditionalDetails from '../components/ConditionalDetails.vue';
import LabeledInput from '../components/LabeledInput.vue';

export default {
  components: {
    ConditionalDetails,
    LabeledInput
  },
  head() {
    const title = this.searchFor ? `Search "${this.searchFor}"` : `Search`;

    return {
      title,
      meta: [
        {
          hid: `title`,
          content: title
        }
      ]
    };
  },
  async asyncData({ query, app }) {
    const sanitizedQuery = getSanitizedQuery(query);

    return {
      searchFor: sanitizedQuery.search,
      searchQuery: sanitizedQuery.search,
      manufacturersQuery: sanitizedQuery.manufacturers,
      categoriesQuery: sanitizedQuery.categories,
      detailsInitiallyOpen: sanitizedQuery.manufacturers.length > 0 || sanitizedQuery.categories.length > 0,
      results: await getSearchResults(app.$axios, sanitizedQuery)
    };
  },
  data() {
    return {
      manufacturers: Object.keys(register.manufacturers).sort((a, b) => a.localeCompare(b, `en`)).map(
        manKey => ({
          key: manKey,
          name: manufacturers[manKey].name,
          fixtureCount: register.manufacturers[manKey].length
        })
      ),
      categories: Object.keys(register.categories).sort((a, b) => a.localeCompare(b, `en`)),
      loading: false,
      isBrowser: false
    };
  },
  computed: {
    fixtureResults() {
      return this.results.map(key => {
        const man = key.split(`/`)[0];

        return {
          key,
          name: `${manufacturers[man].name} ${register.filesystem[key].name}`,
          color: register.colors[man]
        };
      });
    }
  },
  mounted() {
    this.isBrowser = true;

    this._removeSearchQueryChecker = this.$router.afterEach((to, from) => {
      if (to.path === `/search`) {
        this.updateResults();
      }
      else {
        this._removeSearchQueryChecker();
      }
    });
  },
  methods: {
    onSubmit() {
      if (this.searchQuery === ``) {
        return;
      }

      this.$router.push({
        path: this.$route.path,
        query: {
          q: this.searchQuery,
          manufacturers: this.manufacturersQuery,
          categories: this.categoriesQuery
        }
      });
    },
    async updateResults() {
      this.loading = true;

      const sanitizedQuery = getSanitizedQuery(this.$router.history.current.query);
      this.searchQuery = sanitizedQuery.search;
      this.manufacturersQuery = sanitizedQuery.manufacturers;
      this.categoriesQuery = sanitizedQuery.categories;
      this.results = await getSearchResults(this.$axios, sanitizedQuery);
      this.searchFor = sanitizedQuery.search;

      this.loading = false;
    }
  }
};

/**
 * @param {Object} query The raw query returned by Vue Router
 * @returns {Object} Object with properties "search" (string), "manufacturers" and "categories" (arrays of strings).
 */
function getSanitizedQuery(query) {
  const searchQuery = (query.q || ``).trim();

  let manufacturersQuery = query.manufacturers || [];
  if (typeof manufacturersQuery === `string`) {
    manufacturersQuery = [manufacturersQuery];
  }

  let categoriesQuery = query.categories || [];
  if (typeof categoriesQuery === `string`) {
    categoriesQuery = [categoriesQuery];
  }

  return {
    search: searchQuery,
    manufacturers: manufacturersQuery,
    categories: categoriesQuery
  };
}

/**
 * Request search results from the backend.
 * @param {Object} axios The axios instance to use.
 * @param {Object} sanitizedQuery A query object like returned from {@link getSanitizedQuery}.
 * @returns {Promise} The request promise.
 */
function getSearchResults(axios, sanitizedQuery) {
  return axios.$post(`/ajax/get-search-results`, {
    searchQuery: sanitizedQuery.search,
    manufacturersQuery: sanitizedQuery.manufacturers,
    categoriesQuery: sanitizedQuery.categories
  });
}
</script>
