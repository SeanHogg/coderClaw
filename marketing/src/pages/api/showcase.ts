import type { APIRoute } from 'astro';

interface Tweet {
  id: string;
  author: string;
  quote: string;
  likes: number;
  images?: string[];
}

// Fetch tweets from Twitter API v2
async function fetchTwitterTweets(): Promise<Tweet[]> {
  const bearerToken = import.meta.env.TWITTER_BEARER_TOKEN;
  
  if (!bearerToken) {
    console.warn('TWITTER_BEARER_TOKEN not configured, returning empty results');
    return [];
  }

  try {
    // Search for tweets mentioning @coderclaw or #coderclaw
    const searchQuery = '(@coderclaw OR #coderclaw) -is:retweet lang:en';
    const url = new URL('https://api.twitter.com/2/tweets/search/recent');
    
    url.searchParams.append('query', searchQuery);
    url.searchParams.append('max_results', '100');
    url.searchParams.append('tweet.fields', 'created_at,public_metrics,author_id');
    url.searchParams.append('expansions', 'author_id,attachments.media_keys');
    url.searchParams.append('user.fields', 'username');
    url.searchParams.append('media.fields', 'url,preview_image_url');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
      },
    });

    if (!response.ok) {
      console.error('Twitter API error:', response.statusText);
      return [];
    }

    const data = await response.json();
    
    if (!data.data) {
      return [];
    }

    // Map Twitter API response to our Tweet format
    const tweets: Tweet[] = data.data.map((tweet: any) => {
      const user = data.includes?.users?.find((u: any) => u.id === tweet.author_id);
      
      let images: string[] = [];
      if (tweet.attachments?.media_keys) {
        images = tweet.attachments.media_keys
          .map((key: string) => {
            const media = data.includes?.media?.find((m: any) => m.media_key === key);
            return media?.url || media?.preview_image_url;
          })
          .filter(Boolean);
      }

      return {
        id: tweet.id,
        author: user?.username || 'unknown',
        quote: tweet.text,
        likes: tweet.public_metrics?.like_count || 0,
        images: images.length > 0 ? images : undefined,
      };
    });

    return tweets;
  } catch (error) {
    console.error('Error fetching tweets:', error);
    return [];
  }
}

export const GET: APIRoute = async () => {
  try {
    const tweets = await fetchTwitterTweets();
    
    return new Response(JSON.stringify(tweets), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch tweets' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};
