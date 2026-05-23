function handle(inv) {
  var cfg = getCfg(inv);
  var PATH = (inv.path || '').toLowerCase();

  if (PATH.indexOf('/play') !== -1) {
    return handlePlay(inv, cfg);
  }

  if (inv.checksearch) {
    return handleChecksearch(inv, cfg);
  }

  return handleMain(inv, cfg);
}

function getCfg(inv) {
  return {
    indexUrl: (inv.config && inv.config.indexUrl) || 'https://raw.githubusercontent.com/rusanoff1983-del/scts/main/scts_chunks/index.json',
    chunkUrlPrefix: (inv.config && inv.config.chunkUrlPrefix) || 'https://raw.githubusercontent.com/rusanoff1983-del/scts/main/scts_chunks/',
    cacheHours: (inv.config && inv.config.cacheHours) || 24
  };
}

function handleChecksearch(inv, cfg) {
  return { rch: true, type: 'movie', quality: manifest.quality };
}

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchJson(url) {
  var res = http.get(url, { timeout: 30 });
  if (!res.ok) return null;
  try { return res.json(); } catch(e) { return null; }
}

function getIndex(inv, cfg) {
  var cacheKey = 'scts_index';
  var cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  var index = fetchJson(cfg.indexUrl);
  if (!index) return null;

  cache.set(cacheKey, index, cfg.cacheHours * 3600);
  return index;
}

function getChunk(inv, cfg, chunkId) {
  var cacheKey = 'scts_chunk_' + chunkId;
  var cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  var chunkFile = 'chunk_' + String(chunkId + 1).padStart(3, '0') + '.json';
  var chunkUrl = cfg.chunkUrlPrefix + chunkFile;
  var chunk = fetchJson(chunkUrl);

  if (chunk) cache.set(cacheKey, chunk, cfg.cacheHours * 3600);
  return chunk;
}

function findContent(inv, cfg) {
  var query = inv.query || {};
  var title = (query.title || '').trim();
  var year = parseInt(query.year || 0, 10);
  var originalTitle = (query.original_title || '').trim();

  var index = getIndex(inv, cfg);
  if (!index || !index.length) return null;

  var normTitle = normalizeName(title);
  var normOriginal = normalizeName(originalTitle);

  for (var i = 0; i < index.length; i++) {
    var entry = index[i];
    var normEntryName = normalizeName(entry.name);

    if ((normEntryName === normTitle || normEntryName === normOriginal) && (!year || entry.year === String(year))) {
      return { entry: entry, index: index };
    }
  }

  return null;
}

function isSerial(name) {
  return /\(\d+\s+сезон\)/i.test(name);
}

function parseEpisode(filename) {
  var m = /s(\d+)e(\d+)/i.exec(filename);
  return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
}

function handleMovie(inv, cfg, content) {
  var entry = content.entry;
  var chunk = getChunk(inv, cfg, entry.chunk_id);
  if (!chunk) return {};

  var movie = null;
  for (var i = 0; i < chunk.length; i++) {
    if (chunk[i].id === entry.id) {
      movie = chunk[i];
      break;
    }
  }

  if (!movie || !movie.files || !movie.files.length) return {};

  var data = [];
  var seenTranslations = {};

  for (var i = 0; i < movie.files.length; i++) {
    var file = movie.files[i];
    if (file.is_dir) continue;

    var trans = (file.translation && file.translation.length) ? file.translation[0] : 'Озвучка';
    if (seenTranslations[trans]) continue;
    seenTranslations[trans] = true;

    if (file.links && file.links.streams) {
      var streamUrl = file.links.streams['720p'] || Object.keys(file.links.streams)[0];
      if (streamUrl) {
        data.push({
          method: 'play',
          url: proxy.url(streamUrl, 'scts'),
          stream: proxy.url(streamUrl, 'scts'),
          name: trans,
          title: movie.name + ' (' + movie.year + ')',
          quality: file.quality || manifest.quality
        });
      }
    }
  }

  return { type: 'movie', data: data };
}

function handleSerial(inv, cfg, content) {
  var entry = content.entry;
  var chunk = getChunk(inv, cfg, entry.chunk_id);
  if (!chunk) return {};

  var serial = null;
  for (var i = 0; i < chunk.length; i++) {
    if (chunk[i].id === entry.id) {
      serial = chunk[i];
      break;
    }
  }

  if (!serial || !serial.files || !serial.files.length) return {};

  var queryS = parseInt((inv.query && inv.query.s) || -1, 10);
  var queryT = parseInt((inv.query && inv.query.t) || 0, 10);

  if (queryS === -1) {
    return getSeasons(inv, serial, entry);
  }

  return getEpisodes(inv, cfg, serial, entry, queryS, queryT);
}

function getSeasons(inv, serial, entry) {
  var seasons = {};
  var seasonList = [];

  for (var i = 0; i < serial.files.length; i++) {
    var file = serial.files[i];
    if (file.is_dir) continue;

    var ep = parseEpisode(file.name);
    if (!ep) continue;

    if (!seasons[ep.season]) {
      seasons[ep.season] = true;
      seasonList.push(ep.season);
    }
  }

  seasonList.sort(function(a, b) { return a - b; });

  var data = [];
  for (var i = 0; i < seasonList.length; i++) {
    var snum = seasonList[i];
    data.push({
      method: 'link',
      id: snum,
      url: inv.host + '/lite/scts?id=' + util.urlencode(entry.id) + '&s=' + snum,
      name: 'Сезон ' + snum
    });
  }

  return { type: 'season', data: data };
}

function getEpisodes(inv, cfg, serial, entry, season, voiceIdx) {
  var chunk = getChunk(inv, cfg, entry.chunk_id);
  if (!chunk) return {};

  var voices = [];
  var byVoice = {};
  var episodes = [];

  for (var i = 0; i < serial.files.length; i++) {
    var file = serial.files[i];
    if (file.is_dir) continue;

    var ep = parseEpisode(file.name);
    if (!ep || ep.season !== season) continue;

    var voiceName = (file.translation && file.translation.length) ? file.translation[0] : 'Озвучка';

    if (!byVoice[voiceName]) {
      byVoice[voiceName] = [];
      voices.push(voiceName);
    }

    byVoice[voiceName].push({ episode: ep.episode, file: file });
  }

  for (var i = 0; i < voices.length; i++) {
    byVoice[voices[i]].sort(function(a, b) { return a.episode - b.episode; });
  }

  var activeVoice = voices[voiceIdx] || voices[0];
  if (!activeVoice || !byVoice[activeVoice]) return {};

  var episodeList = byVoice[activeVoice];

  for (var i = 0; i < episodeList.length; i++) {
    var ep = episodeList[i];
    var streamUrl = ep.file.links && ep.file.links.streams ? (ep.file.links.streams['720p'] || Object.keys(ep.file.links.streams)[0]) : null;

    if (streamUrl) {
      episodes.push({
        method: 'play',
        url: proxy.url(streamUrl, 'scts'),
        stream: proxy.url(streamUrl, 'scts'),
        name: 'Эпизод ' + ep.episode,
        title: serial.name + ' S' + season + 'E' + ep.episode,
        s: season,
        e: ep.episode
      });
    }
  }

  var voiceButtons = [];
  for (var i = 0; i < voices.length; i++) {
    voiceButtons.push({
      name: voices[i],
      active: voices[i] === activeVoice,
      url: inv.host + '/lite/scts?id=' + util.urlencode(entry.id) + '&s=' + season + '&t=' + i
    });
  }

  return {
    type: 'episode',
    data: episodes,
    voice: voiceButtons
  };
}

function handleMain(inv, cfg) {
  var content = findContent(inv, cfg);
  if (!content) return {};

  return isSerial(content.entry.name) 
    ? handleSerial(inv, cfg, content)
    : handleMovie(inv, cfg, content);
}

function handlePlay(inv, cfg) {
  return {};
}
