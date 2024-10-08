var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var { ApolloServer } = require("apollo-server-express");
var { gql } = require("graphql-tag");
var { GraphQLScalarType, Kind } = require("graphql");
var { LRUCache } = require("lru-cache");
var axios = require("axios");
var dotenv = require("dotenv");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");

// Load environment variables from .env file
dotenv.config();

var app = express();

/**
 * Middlewares setup for security, logging, parsing, etc.
 */
app.use(helmet());
app.use(bodyParser.json());
app.use(cors());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter); // Root route
app.use("/users", usersRouter); // Users route

// LFU Cache setup for caching responses
const cache = new LRUCache({
  max: 100, // Maximum number of items in cache
  maxAge: 1000 * 60 * 15, // Items expire after 15 minutes
});

// GraphQL schema definition
const typeDefs = gql`
  scalar Date

  type Token {
    id: ID!
    name: String!
    symbol: String!
    price: Float!
    marketCap: Float!
    volume24h: Float!
    percentageChange1h: Float!
    circulatingSupply: Float!
    maxSupply: Float
    lastUpdated: Date
  }

  type TokenInfo {
    id: ID!
    name: String!
    symbol: String!
    category: String
    description: String
    slug: String
    logo: String
    subreddit: String
    notice: String
    tags: [String]
    platform: String
    dateAdded: Date
    twitterUsername: String
    isHidden: Int
  }

  type Ticker {
    timestamp: String!
    price: Float!
    volume24h: Float!
    marketCap: Float!
  }

  type Query {
    tokens(limit: Int = 10): [Token]
    token(id: ID!): Token
    tokenInfo(ids: String!): [TokenInfo]
    getCryptoTickers(
      cryptoId: String!
      startDate: String!
      endDate: String
      limit: Int
    ): [Ticker]
  }
`;

// Custom scalar for handling Date type in GraphQL
const dateScalar = new GraphQLScalarType({
  name: "Date",
  description: "Date custom scalar type",
  serialize(value) {
    // Convert outgoing Date to timestamp
    return value.getTime();
  },
  parseValue(value) {
    // Convert incoming timestamp to Date
    return new Date(value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.INT) {
      return new Date(parseInt(ast.value, 10)); // Parse Date from integer
    }
    return null;
  },
});

// GraphQL resolvers
const resolvers = {
  Date: dateScalar,
  Query: {
    tokens: async (_, { limit }) => {
      const cacheKey = `tokens:${limit}`; // Cache key for token query
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey); // Return from cache if available
      }

      try {
        const response = await axios.get(
          `${process.env.CMC_API_URL}/v1/cryptocurrency/listings/latest`,
          {
            params: { limit },
            headers: {
              "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
            },
          }
        );

        const tokens = response.data.data.map((token) => ({
          id: token.id,
          name: token.name,
          symbol: token.symbol,
          price: token.quote.USD.price,
          marketCap: token.quote.USD.market_cap,
          volume24h: token.quote.USD.volume_24h,
          percentageChange1h: token.quote.USD.percent_change_1h,
          circulatingSupply: token.circulating_supply,
          maxSupply: token.max_supply,
          lastUpdated: new Date(token.last_updated),
        }));

        cache.set(cacheKey, tokens); // Cache the result
        return tokens;
      } catch (error) {
        console.error("Error fetching tokens:", error);
        throw new Error("Failed to fetch tokens");
      }
    },
    token: async (_, { id }) => {
      const cacheKey = `token:${id}`; // Cache key for single token query
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey); // Return from cache if available
      }

      try {
        const response = await axios.get(
          `${process.env.CMC_API_URL}/v1/cryptocurrency/quotes/latest`,
          {
            params: { id },
            headers: {
              "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
            },
          }
        );

        const tokenData = response.data.data[id];
        const token = {
          id: tokenData.id,
          name: tokenData.name,
          symbol: tokenData.symbol,
          price: tokenData.quote.USD.price,
          marketCap: tokenData.quote.USD.market_cap,
          volume24h: tokenData.quote.USD.volume_24h,
          circulatingSupply: tokenData.circulating_supply,
          maxSupply: tokenData.max_supply,
          lastUpdated: new Date(tokenData.last_updated),
        };

        cache.set(cacheKey, token); // Cache the result
        return token;
      } catch (error) {
        console.error(`Error fetching token ${id}:`, error);
        throw new Error(`Failed to fetch token ${id}`);
      }
    },
    tokenInfo: async (_, { ids }) => {
      const cacheKey = `tokenInfo:${ids}`; // Cache key for token info query
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey); // Return from cache if available
      }

      try {
        const response = await axios.get(
          `${process.env.CMC_API_URL}/v1/cryptocurrency/info`,
          {
            params: { id: ids },
            headers: {
              "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
            },
          }
        );

        const tokenInfoArray = Object.values(response.data.data).map(
          (token) => ({
            id: token.id,
            name: token.name,
            symbol: token.symbol,
            category: token.category,
            description: token.description,
            slug: token.slug,
            logo: token.logo,
            subreddit: token.subreddit,
            notice: token.notice,
            tags: token.tags,
            platform: token.platform ? token.platform.name : null,
            dateAdded: new Date(token.date_added),
            twitterUsername: token.twitter_username,
            isHidden: token.is_hidden,
          })
        );

        cache.set(cacheKey, tokenInfoArray); // Cache the result
        return tokenInfoArray;
      } catch (error) {
        console.error(`Error fetching token info for ids ${ids}:`, error);
        throw new Error(`Failed to fetch token info for ids ${ids}`);
      }
    },
    getCryptoTickers: async (
      _,
      { cryptoId, startDate, endDate, limit = 30 }
    ) => {
      const cacheKey = `tickers:${cryptoId}:${startDate}:${endDate}:${limit}`; // Cache key for ticker query

      if (cache.has(cacheKey)) {
        return cache.get(cacheKey); // Return from cache if available
      }

      try {
        const response = await axios.get(
          `${process.env.CP_API_URL}/v1/tickers/${cryptoId}/historical`,
          {
            params: {
              start: startDate,
              end: endDate,
              interval: "7d",
              limit: limit,
            },
          }
        );

        if (!response.data || response.data.length === 0) {
          throw new Error("No data available for the specified parameters");
        }

        const tickers = response.data.map((tickerData) => ({
          timestamp: tickerData.timestamp,
          price: tickerData.price,
          volume24h: tickerData.volume_24h,
          marketCap: tickerData.market_cap,
        }));

        cache.set(cacheKey, tickers); // Cache the result
        return tickers;
      } catch (error) {
        console.error("Error fetching crypto tickers:", error);
        throw new Error("Failed to fetch cryptocurrency ticker data");
      }
    },
  },
};

// Start the Apollo Server
async function startApolloServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => {
      // Context for request, add authentication logic if needed
      return { user: req.user };
    },
  });

  await server.start();

  server.applyMiddleware({ app }); // Apply the middleware to the express app
}

startApolloServer().catch((error) => {
  console.error("Failed to start Apollo Server:", error);
});

module.exports = app; // Export the express app
