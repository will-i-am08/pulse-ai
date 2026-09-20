import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/seo';

/**
 * robots.txt. Marketing surface is open to all crawlers; the app, auth and API
 * surfaces are kept out of the index. GEO note: we explicitly welcome the AI
 * answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
 * etc.) so Kip can be read and cited by generative search.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = ['/api/', '/app/', '/login', '/signup', '/payment', '/auth/', '/c/', '/d/', '/feed', '/lab', '/check-messages'];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
      // AI answer engines — allowed on the public marketing surface.
      {
        userAgent: [
          'GPTBot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'ClaudeBot',
          'Claude-Web',
          'anthropic-ai',
          'PerplexityBot',
          'Perplexity-User',
          'Google-Extended',
          'Applebot-Extended',
          'CCBot',
        ],
        allow: '/',
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
