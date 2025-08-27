const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '7778921560:AAHH0gGaN7UfaKhQYwwiAwaMKxz9LiJgpWg';

const bot = new Telegraf(BOT_TOKEN);

// Free news sources with no API keys required
const NEWS_SOURCES = {
  BBC: 'https://www.bbc.com/news',
  REUTERS: 'https://www.reuters.com/news/archive/technologyNews',
  TECHCRUNCH: 'https://techcrunch.com/',
  THE_GUARDIAN: 'https://www.theguardian.com/international',
  CNN: 'https://edition.cnn.com/world'
};

// Categories
const CATEGORIES = [
  'technology', 'world', 'business', 'science', 
  'health', 'sports', 'entertainment'
];

// User preferences storage
const userPreferences = new Map();
const subscribers = new Set();

// Middleware
app.use(express.json());

// Helper function to format news
function formatNewsArticle(article, source) {
  return `📰 *${article.title}*\n\n` +
         `📖 ${article.description || 'Read more...'}\n\n` +
         `🔗 [Read full article](${article.url})\n` +
         `🏷️ Source: ${source}\n` +
         `📅 ${article.date || new Date().toLocaleDateString()}`;
}

// Fetch news from BBC (web scraping)
async function fetchBBCNews(category = 'technology') {
  try {
    const response = await axios.get(`${NEWS_SOURCES.BBC}/${category}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const articles = [];
    
    $('.gs-c-promo').slice(0, 10).each((i, element) => {
      const title = $(element).find('.gs-c-promo-heading__title').text().trim();
      const url = $(element).find('a').attr('href');
      const description = $(element).find('.gs-c-promo-summary').text().trim();
      
      if (title && url) {
        articles.push({
          title,
          url: url.startsWith('http') ? url : `https://www.bbc.com${url}`,
          description: description || 'No description available',
          source: 'BBC News',
          date: new Date().toLocaleDateString()
        });
      }
    });
    
    return articles;
  } catch (error) {
    console.error('BBC News Error:', error.message);
    return [];
  }
}

// Fetch news from Reuters
async function fetchReutersNews() {
  try {
    const response = await axios.get(NEWS_SOURCES.REUTERS, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const articles = [];
    
    $('.story-content').slice(0, 10).each((i, element) => {
      const title = $(element).find('a').text().trim();
      const url = $(element).find('a').attr('href');
      const description = $(element).find('p').first().text().trim();
      
      if (title && url) {
        articles.push({
          title,
          url: url.startsWith('http') ? url : `https://www.reuters.com${url}`,
          description: description || 'No description available',
          source: 'Reuters',
          date: new Date().toLocaleDateString()
        });
      }
    });
    
    return articles;
  } catch (error) {
    console.error('Reuters Error:', error.message);
    return [];
  }
}

// Fetch news from Hacker News (official API - no key needed)
async function fetchHackerNews() {
  try {
    const topStoriesResponse = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topStoryIds = topStoriesResponse.data.slice(0, 15);
    
    const stories = await Promise.all(
      topStoryIds.map(async (id) => {
        try {
          const storyResponse = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const story = storyResponse.data;
          
          return {
            title: story.title || 'No title',
            url: story.url || `https://news.ycombinator.com/item?id=${id}`,
            description: `Score: ${story.score} | Comments: ${story.descendants || 0}`,
            source: 'Hacker News',
            date: new Date(story.time * 1000).toLocaleDateString()
          };
        } catch (error) {
          return null;
        }
      })
    );
    
    return stories.filter(story => story !== null);
  } catch (error) {
    console.error('Hacker News Error:', error.message);
    return [];
  }
}

// Fetch news from Reddit
async function fetchRedditNews(subreddit = 'news') {
  try {
    const response = await axios.get(`https://www.reddit.com/r/${subreddit}/.json?limit=15`, {
      headers: {
        'User-Agent': 'Telegram News Bot/1.0'
      }
    });
    
    return response.data.data.children.map(post => ({
      title: post.data.title,
      url: post.data.url,
      description: post.data.selftext?.substring(0, 200) + '...' || 'Click to read more',
      source: `Reddit r/${subreddit}`,
      date: new Date(post.data.created_utc * 1000).toLocaleDateString()
    }));
  } catch (error) {
    console.error('Reddit Error:', error.message);
    return [];
  }
}

// Fetch news from multiple sources
async function fetchAllNews(category = 'technology') {
  try {
    const [bbcNews, reutersNews, hackerNews, redditNews] = await Promise.all([
      fetchBBCNews(category),
      fetchReutersNews(),
      fetchHackerNews(),
      fetchRedditNews(category === 'technology' ? 'technology' : 'news')
    ]);
    
    // Combine and shuffle news
    const allNews = [...bbcNews, ...reutersNews, ...hackerNews, ...redditNews];
    return allNews.sort(() => Math.random() - 0.5).slice(0, 20);
  } catch (error) {
    console.error('Error fetching news:', error.message);
    return [];
  }
}

// Bot commands
bot.start((ctx) => {
  const welcomeMessage = `📰 *Welcome to Free News Bot!* 📰\n\n` +
    `I bring you the latest news from free sources - no API keys needed! 🌟\n\n` +
    `*Available commands:*\n` +
    `/news - Get latest news\n` +
    `/category - Change news category\n` +
    `/tech - Technology news\n` +
    `/world - World news\n` +
    `/subscribe - Daily news updates\n` +
    `/unsubscribe - Stop daily updates\n` +
    `/help - Show help menu`;

  ctx.replyWithMarkdown(welcomeMessage, Markup.keyboard([
    ['📰 Latest News', '💻 Tech News'],
    ['🌍 World News', '🔔 Subscribe'],
    ['⚙️ Settings', '❓ Help']
  ]).resize());
});

bot.help((ctx) => {
  ctx.replyWithMarkdown(`
*Free News Bot Help* 📚

*Commands:*
/news - Get latest news
/tech - Technology news
/world - World news
/business - Business news
/science - Science news
/health - Health news
/sports - Sports news
/entertainment - Entertainment news
/subscribe - Daily news updates
/unsubscribe - Stop updates
/help - This help menu

*Sources:* BBC, Reuters, Hacker News, Reddit
*100% Free - No API keys required!* 🎉
  `);
});

// News command
bot.command('news', async (ctx) => {
  await sendNews(ctx, 'general');
});

// Category commands
bot.command('tech', async (ctx) => {
  await sendNews(ctx, 'technology');
});

bot.command('world', async (ctx) => {
  await sendNews(ctx, 'world');
});

bot.command('business', async (ctx) => {
  await sendNews(ctx, 'business');
});

bot.command('science', async (ctx) => {
  await sendNews(ctx, 'science');
});

bot.command('health', async (ctx) => {
  await sendNews(ctx, 'health');
});

bot.command('sports', async (ctx) => {
  await sendNews(ctx, 'sports');
});

bot.command('entertainment', async (ctx) => {
  await sendNews(ctx, 'entertainment');
});

// Send news function
async function sendNews(ctx, category) {
  try {
    const message = await ctx.reply('📡 Fetching latest news...');
    
    const news = await fetchAllNews(category);
    
    if (news.length === 0) {
      await ctx.editMessageText('❌ Sorry, could not fetch any news at the moment. Please try again later.');
      return;
    }
    
    await ctx.deleteMessage(message.message_id);
    
    // Send first 5 news articles
    const newsToSend = news.slice(0, 5);
    for (const article of newsToSend) {
      try {
        await ctx.replyWithMarkdown(formatNewsArticle(article, article.source), {
          disable_web_page_preview: false
        });
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('Error sending article:', error.message);
      }
    }
    
    await ctx.reply(
      `✅ Fetched ${newsToSend.length} news articles from ${category} category!\n\n` +
      `Use /help to see all available commands.`,
      Markup.keyboard([
        ['📰 Latest News', '💻 Tech News'],
        ['🌍 World News', '🔔 Subscribe']
      ]).resize()
    );
    
  } catch (error) {
    console.error('Error in sendNews:', error);
    ctx.reply('❌ Error fetching news. Please try again later.');
  }
}

// Subscription commands
bot.command('subscribe', (ctx) => {
  subscribers.add(ctx.from.id);
  
  // Set default preferences if not set
  if (!userPreferences.has(ctx.from.id)) {
    userPreferences.set(ctx.from.id, {
      category: 'technology',
      lastUpdated: new Date()
    });
  }
  
  ctx.reply('✅ Subscribed to daily news updates! You will receive news every day at 9 AM.\n\nUse /unsubscribe to stop updates.');
});

bot.command('unsubscribe', (ctx) => {
  subscribers.delete(ctx.from.id);
  ctx.reply('❌ Unsubscribed from daily news updates.');
});

// Handle inline keyboard buttons
bot.hears('📰 Latest News', async (ctx) => {
  await sendNews(ctx, 'general');
});

bot.hears('💻 Tech News', async (ctx) => {
  await sendNews(ctx, 'technology');
});

bot.hears('🌍 World News', async (ctx) => {
  await sendNews(ctx, 'world');
});

bot.hears('🔔 Subscribe', (ctx) => {
  subscribers.add(ctx.from.id);
  ctx.reply('✅ Subscribed to daily news updates!');
});

bot.hears('⚙️ Settings', (ctx) => {
  ctx.reply('Settings menu:', Markup.inlineKeyboard([
    [Markup.button.callback('Change Category 🏷️', 'change_category')],
    [Markup.button.callback('Subscription Status 🔔', 'subscription_status')],
    [Markup.button.callback('Bot Info ℹ️', 'bot_info')]
  ]));
});

bot.hears('❓ Help', (ctx) => {
  ctx.replyWithMarkdown(`
*Need help?* 🤔

Just use these commands:
- /news - Latest news
- /tech - Technology news
- /world - World news
- /subscribe - Daily updates
- /unsubscribe - Stop updates
- /help - This message

*All news is fetched from free public sources!* 🎉
  `);
});

// Category selection
bot.action('change_category', (ctx) => {
  ctx.editMessageText('Choose news category:', Markup.inlineKeyboard([
    [Markup.button.callback('Technology 💻', 'cat_technology')],
    [Markup.button.callback('World 🌍', 'cat_world')],
    [Markup.button.callback('Business 💼', 'cat_business')],
    [Markup.button.callback('Science 🔬', 'cat_science')],
    [Markup.button.callback('Health 🏥', 'cat_health')]
  ]));
});

// Handle category selection
bot.action(/cat_(.+)/, async (ctx) => {
  const category = ctx.match[1];
  const userId = ctx.from.id;
  
  userPreferences.set(userId, {
    category,
    lastUpdated: new Date()
  });
  
  await ctx.editMessageText(`✅ Category set to: ${category}`);
  await sendNews(ctx, category);
});

// Scheduled news delivery (every day at 9 AM)
cron.schedule('0 9 * * *', async () => {
  console.log('📧 Sending daily news to subscribers...');
  
  for (const userId of subscribers) {
    try {
      const userPrefs = userPreferences.get(userId) || { category: 'technology' };
      const news = await fetchAllNews(userPrefs.category);
      const newsToSend = news.slice(0, 3);
      
      if (newsToSend.length > 0) {
        await bot.telegram.sendMessage(userId, `🌅 *Good morning! Here's your daily news:*`, {
          parse_mode: 'Markdown'
        });
        
        for (const article of newsToSend) {
          await bot.telegram.sendMessage(
            userId, 
            formatNewsArticle(article, article.source),
            { parse_mode: 'Markdown' }
          );
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error(`Error sending to user ${userId}:`, error.message);
    }
  }
});

// Express routes
app.get('/', (req, res) => {
  res.json({
    status: 'News Bot is running!',
    subscribers: subscribers.size,
    totalUsers: userPreferences.size,
    sources: Object.keys(NEWS_SOURCES)
  });
});

app.get('/stats', (req, res) => {
  const categories = {};
  userPreferences.forEach(prefs => {
    categories[prefs.category] = (categories[prefs.category] || 0) + 1;
  });
  
  res.json({
    totalSubscribers: subscribers.size,
    totalUsers: userPreferences.size,
    categoryDistribution: categories,
    lastUpdate: new Date().toISOString()
  });
});

// Start bot
if (process.env.NODE_ENV === 'production') {
  const secretPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(bot.webhookCallback(secretPath));
  bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}${secretPath}`);
} else {
  bot.launch();
}

app.listen(PORT, () => {
  console.log(`🚀 Free News Bot running on port ${PORT}`);
  console.log(`📰 Sources: BBC, Reuters, Hacker News, Reddit`);
  console.log(`👥 Subscribers: ${subscribers.size}`);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));