/** 照 Last.fm `artist.getInfo` 的 JSON 写的应答，正文按它的格式在末尾带「Read more」与许可声明。 */
export function artistInfoSample(
  artist = 'Nujabes',
  content = '瀬葉淳是日本的唱片制作人。\n\n他创办了 <a href="https://www.last.fm/label/Hydeout">Hydeout Productions</a>。',
) {
  const url = `https://www.last.fm/music/${encodeURIComponent(artist).replace(/%20/g, '+')}`;
  return {
    artist: {
      name: artist,
      mbid: '1595addf-f76b-450a-a097-af852ff35f27',
      url,
      image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/34s/x.png', size: 'small' }],
      stats: { listeners: '846123', playcount: '51200345' },
      similar: {
        artist: [
          { name: 'Uyama Hiroto', url: 'https://www.last.fm/music/Uyama+Hiroto' },
          { name: 'Fat Jon', url: 'https://www.last.fm/music/Fat+Jon' },
          { name: 'Impostor', url: 'https://www.last.fm/music/Someone+Else' },
        ],
      },
      tags: {
        tag: [
          { name: 'Hip-Hop', url: 'https://www.last.fm/tag/hip-hop' },
          { name: 'hip-hop', url: 'https://www.last.fm/tag/hip-hop' },
          { name: artist, url: 'https://www.last.fm/tag/x' },
          { name: 'Jazz Rap', url: 'https://www.last.fm/tag/jazz+rap' },
        ],
      },
      bio: {
        links: { link: { '#text': '', rel: 'original', href: `${url}/+wiki` } },
        summary: `摘要 <a href="${url}">Read more on Last.fm</a>`,
        content: content
          ? `${content} <a href="${url}">Read more on Last.fm</a>. User-contributed text is available under the Creative Commons By-SA License; additional terms may apply.`
          : '',
      },
    },
  };
}

export function apiReply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    success: true as const,
    status,
    headers,
    body: JSON.stringify(body),
    responseType: 'text' as const,
  };
}
