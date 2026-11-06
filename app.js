'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const video = $('video');
  const S = window.Subtitles;
  const P = window.PlayerUtils;
  const C = window.StoryCatalog;
  const CS = window.CaptionStyle;
  const store = window.LibraryStore;
  const remote = window.SecureLibrary;
  const stateKey = remote ? 'sprechzimmer.remote.state' : 'sprechzimmer.state';
  const LANGUAGES = {ar:'Arabic',en:'English',fr:'French',es:'Spanish',tr:'Turkish',fa:'Persian',ur:'Urdu',ru:'Russian',uk:'Ukrainian',it:'Italian',pt:'Portuguese',pl:'Polish',hi:'Hindi',zh:'Chinese',ja:'Japanese',ko:'Korean'};
  const SAMPLE = [
    ['Guten Morgen! Bist du bereit für einen neuen Tag?','صباح الخير! هل أنت مستعد ليوم جديد؟'],
    ['Ich hätte gern einen Kaffee und ein Brötchen.','أودّ قهوة وخبزة صغيرة، من فضلك.'],
    ['Natürlich. Möchtest du auch etwas Wasser?','بالطبع. هل تريد بعض الماء أيضًا؟'],
    ['Ja, bitte. Wie viel kostet das zusammen?','نعم، من فضلك. كم ثمن كل ذلك؟'],
    ['Das macht fünf Euro und zwanzig Cent.','المجموع خمسة يورو وعشرون سنتًا.'],
    ['Entschuldigung, wo ist die nächste Haltestelle?','عذرًا، أين أقرب محطة؟'],
    ['Geh geradeaus und dann nach links.','اذهب مباشرةً ثم انعطف يسارًا.'],
    ['Vielen Dank für deine Hilfe!','شكرًا جزيلًا على مساعدتك!'],
    ['Kein Problem. Ich wünsche dir einen schönen Tag.','لا مشكلة. أتمنى لك يومًا جميلًا.'],
    ['Jeden Tag ein bisschen. So wird es leichter.','قليلٌ كل يوم. هكذا يصبح الأمر أسهل.']
  ];
  const demo = {id:'demo',title:'A little German, every day',de:SAMPLE.map((pair,i) => ({start:i*4+0.2,end:i*4+3.7,text:pair[0]})),tracks:{ar:{code:'ar',name:'Arabic',source:'Original sample · translated',cues:SAMPLE.map((pair,i) => ({start:i*4+0.2,end:i*4+3.7,text:pair[1]}))}},video:'./practice.mp4'};
  const defaults = {last:'demo',saved:[],progress:{},settings:{mother:'ar',speed:1,captionMode:'dual',showSecond:true,autoPause:false,autoFollow:true,theme:'system',volume:1,muted:false,collection:'simpsons-s06',captions:CS.defaults},timing:{},reviews:0,welcomed:false};
  let state = structuredClone(defaults), storageWarning = false;
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey) || 'null');
    if (saved && saved.version === 1) state = {...defaults,...saved,settings:{...defaults.settings,...saved.settings}};
  } catch {storageWarning = true;}
  let localEpisodes = new Map(), folderEpisodes = new Map();
  let current = demo, cues = [], cueIndex = S.index([]), tracks = {}, translations = [], active = -1, selected = 0;
  let currentTrack = state.settings.mother, loading = 0, objectURL = null, loadedVideo = false, lastSaved = 0;
  let rowNodes = new Map(), renderedStart = -1, filter = '', loopIndex = -1, suppressAutoPause = -1, frameHandle = null;
  let savedMode = false, translationJob = null, aiAvailable = false, reviewDeck = [], reviewIndex = 0, savedKeys = new Set(state.saved.map(item => item.key));
  let persistFailed = false;
  let page = 'home', continueID = 'demo', feedbackTimer;
  const format = time => {time = Math.max(0,Math.floor(time || 0)); return `${Math.floor(time/60).toString().padStart(2,'0')}:${(time%60).toString().padStart(2,'0')}`;};
  const title = id => id === 'demo' ? demo.title : C.get(id)?.label || 'Unknown episode';
  const key = (id,cue) => `${id}:${cue.start.toFixed(3)}:${cue.text}`;
  let toastTimer;
  function toast(message) {$('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'),4000);if (document.fullscreenElement === $('player')) feedback(message);}
  function feedback(message) {$('player-feedback').textContent = message;$('player-feedback').hidden = false;clearTimeout(feedbackTimer);feedbackTimer = setTimeout(() => $('player-feedback').hidden = true,1400);}
  function notice(message) {$('app-status').textContent = message; $('app-status').hidden = !message;}
  function persist() {
    try {localStorage.setItem(stateKey,JSON.stringify({...state,progress:remote ? {} : state.progress,version:1}));}
    catch {if (!persistFailed) {toast('Browser storage is full or unavailable. Export a backup to keep this session.'); persistFailed = true;}}
  }
  function options(select,includeGerman = false) {
    for (const [code,name] of Object.entries(includeGerman ? {de:'German',...LANGUAGES} : LANGUAGES)) {const option = new Option(`${code.toUpperCase()} · ${name}`,code); select.add(option);}
    select.value = state.settings.mother;
  }
  function el(tag,className,text) {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;}
  function download(name,text,type) {const url = URL.createObjectURL(new Blob([text],{type}));const a = el('a');a.href = url;a.download = name;document.body.append(a);a.click();a.remove();setTimeout(() => URL.revokeObjectURL(url),2000);}
  function meta(id) {
    if (id === 'demo') return demo;
    const local = localEpisodes.get(id), folder = folderEpisodes.get(id);
    const available = new Set([...(folder?.tracks || []).map(t => t.code),...Object.keys(local?.tracks || {})]);
    if (local?.de?.length) available.add('de');
    return {id,hasVideo:!!(local?.hasVideo || folder?.video),available,local,folder};
  }
  function subtitleCoverage(entries) {
    const counts = new Map();
    for (const entry of entries) for (const code of meta(entry.id).available) counts.set(code,(counts.get(code) || 0)+1);
    return [...counts].sort((a,b) => a[0] === 'de' ? -1 : b[0] === 'de' ? 1 : a[0].localeCompare(b[0]));
  }
  function renderLibrary() {
    const fragment = document.createDocumentFragment(); let count = 0;
    const collection = C.collection(state.settings.collection), entries = C.inCollection(collection.id);
    $('collection-select').value = collection.id;$('collection-name').textContent = collection.name;$('collection-season').textContent = `SEASON ${String(collection.season).padStart(2,'0')} · ${collection.count} EPISODES`;$('collection-description').textContent = collection.description;
    for (const entry of entries) {
      const {id,number:i} = entry, episode = meta(id);
      if (episode.hasVideo) count++;
      if ($('ready-only').checked && !episode.hasVideo) continue;
      const button = el('button',`episode${current.id === id ? ' selected' : ''}`);
      button.dataset.episode = id;button.setAttribute('aria-pressed',String(current.id === id));
      button.append(el('span','ep-num',`S${String(collection.season).padStart(2,'0')} / EPISODE ${String(i).padStart(2,'0')}`),el('strong','',`Episode ${String(i).padStart(2,'0')}`));
      button.append(el('small',episode.hasVideo ? 'ready' : '',episode.hasVideo ? '● Video available' : '＋ Add a local video'));
      const tags = el('div','episode-tracks');
      for (const code of episode.available) tags.append(el('span','track-tag',code.toUpperCase()));
      if (!episode.available.size) tags.append(el('span','missing-track','No subtitles yet'));
      button.append(tags);
      const progress = state.progress[id];
      if (progress?.duration) {const bar = el('progress','episode-progress');bar.max = progress.duration;bar.value = progress.time;bar.setAttribute('aria-label','Episode progress');button.append(bar,el('small','',`${format(progress.time)} watched`));}
      fragment.append(button);
    }
    $('episodes').replaceChildren(fragment);
    if (!fragment.childNodes.length && $('ready-only').checked && count === 0) $('episodes').append(el('p','no-lines','No local episodes yet. Add files or put your videos in the media folder, then refresh.'));
    $('library-count').textContent = `${count} / ${entries.length} WITH VIDEO`;
    const coverage = subtitleCoverage(entries), coverageNodes = [el('span','coverage-label','SUBTITLE COVERAGE')];
    for (const [code,total] of coverage) coverageNodes.push(el('span','coverage-tag',`${code.toUpperCase()} ${total} / ${entries.length}`));
    if (!coverage.length) coverageNodes.push(el('span','coverage-empty','No subtitle tracks available yet'));
    $('collection-coverage').replaceChildren(...coverageNodes);
    renderDashboard();
  }
  async function refreshFolder(silent = false) {
    try {
      let episodes;
      if (remote) episodes = await remote.list(!silent);
      else {
        const response = await fetch('/api/library');
        if (!response.ok) throw new Error('Library is unavailable.');
        ({episodes} = await response.json());
      }
      folderEpisodes = new Map(episodes.map(episode => [episode.id,episode]));
      renderLibrary();
      if (!silent) {
        await loadEpisode(current.id);
        toast(remote ? 'Encrypted library refreshed.' : 'Local media folder refreshed.');
      }
    }
    catch (error) {if (!silent) toast(error.message);}
  }
  async function readSubtitles(file,language = 'de',encoding = 'auto') {
    if (file.size > 10_000_000) throw new Error('Subtitle files must be smaller than 10 MB.');
    const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer);
    let text;
    if (encoding !== 'auto') text = new TextDecoder(encoding,{fatal:true}).decode(buffer);
    else if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) text = new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buffer);
    else {try {text = new TextDecoder('utf-8',{fatal:true}).decode(buffer);} catch {text = new TextDecoder(['ar','fa','ur'].includes(language) ? 'windows-1256' : 'windows-1252').decode(buffer);}}
    return S.parse(text);
  }
  function timing() {return state.timing[current.id] || {de:0,tracks:{}};}
  function offset() {return Number(timing().de) || 0;}
  function secondOffset() {return Number(timing().tracks?.[currentTrack]) || 0;}
  function alignTracks() {
    const secondary = tracks[currentTrack]?.cues || [];
    const delta = secondOffset() - offset();
    translations = S.align(cues,secondary.map(cue => ({...cue,start:cue.start+delta,end:cue.end+delta})));
  }
  async function loadEpisode(id,forceTime) {
    const token = ++loading;
    const entry = C.get(id);if (entry) state.settings.collection = entry.collection;
    saveProgress();video.pause();loadedVideo = false;video.removeAttribute('src');video.load();
    if (objectURL) {URL.revokeObjectURL(objectURL);objectURL = null;}
    current = {id};active = -1;selected = 0;loopIndex = -1;suppressAutoPause = -1;syncLoop();
    cues = [];cueIndex = S.index([]);tracks = {};translations = [];renderLines(true);
    $('player-empty').hidden = false;$('empty-title').textContent = 'Opening your story…';$('empty-desc').textContent = '';
    $('episode-title').textContent = title(id);$('caption-overlay').hidden = true;
    $('german-source').textContent = '';
    let source, data;
    try {
      if (id === 'demo') {const local = localEpisodes.get('demo');data = {...demo,de:local?.de || demo.de,tracks:{...demo.tracks,...local?.tracks}};source = demo.video;}
      else {
        const episode = meta(id), local = episode.local || {};
        const folderGerman = episode.folder?.tracks.find(track => track.code === 'de');
        const preferFolder = S.preferFolderGerman(local,folderGerman);
        data = {id,de:preferFolder ? [] : local.de || [],deSource:local.deSource || 'browser-subtitles',deRevision:local.deRevision,tracks:{...local.tracks}};
        const remoteTracks = await Promise.all((episode.folder?.tracks || []).map(async track => {
          const localTrack = local.tracks?.[track.code];
          const userTrack = ['Imported subtitle file','AI generated · local Ollama'].includes(localTrack?.source);
          const preferTranslation = track.kind === 'ai-translation' && !userTrack;
          if ((track.code === 'de' && local.de?.length && !preferFolder) || (localTrack && !preferTranslation)) return null;
          const response = await fetch(track.url);if (!response.ok) throw new Error(`Could not read ${track.name} subtitles.`);
          return {...track,cues:await readSubtitles(await response.blob(),track.code)};
        }));
        for (const track of remoteTracks.filter(Boolean)) {if (track.code === 'de') {data.de = track.cues;data.deTrack = track;data.deSource = track.kind || 'folder-subtitles';data.deRevision = track.revision;}else data.tracks[track.code] = track;}
        const blob = local.hasVideo ? await store.video(id) : null;
        if (token !== loading) return;
        if (blob) {objectURL = URL.createObjectURL(blob);source = objectURL;} else source = episode.folder?.video;
      }
      if (token !== loading) return;
      cues = data.de || [];cueIndex = S.index(cues);tracks = data.tracks || {};
      current = {...data,id};
      const migratedTiming = S.timingForGermanTrack(state.timing[id],data.deTrack);
      if (migratedTiming) state.timing[id] = migratedTiming;
      currentTrack = tracks[state.settings.mother] ? state.settings.mother : Object.keys(tracks)[0] || state.settings.mother;
      updateTrackMenu();alignTracks();filter = '';$('search').value = '';renderedStart = -1;renderLines(true);
      state.last = id;persist();renderLibrary();
      $('de-offset').value = offset();$('second-offset').value = secondOffset();
      $('video-badge').hidden = id !== 'demo';
      $('practice-scene').hidden = id !== 'demo';
      $('episode-meta').textContent = id === 'demo' ? 'Original silent practice clip · German + Arabic · 40 sec' : `Season ${String(entry.season).padStart(2,'0')} · Episode ${String(entry.number).padStart(2,'0')} · ${source ? remote && !source.startsWith('blob:') ? 'Encrypted German video' : 'Local German video' : 'Video missing'}`;
      $('player-empty').hidden = !!source;
      if (source) {
        const resume = Number.isFinite(forceTime) ? forceTime : state.progress[id]?.time || 0;
        video.onloadedmetadata = () => {
          if (token !== loading) return;
          loadedVideo = true;video.playbackRate = state.settings.speed;
          if (resume > 0 && resume < video.duration - 0.5) {video.currentTime = resume;if (page === 'watch' && !Number.isFinite(forceTime)) toast(`Resumed at ${format(resume)}.`);}
          syncControls();tick(true);
        };
        video.src = source;video.load();
      } else {
        $('empty-title').textContent = 'Your episode belongs here.';
        $('empty-desc').textContent = 'Add your German video to this slot. Any available subtitles are ready to explore.';
        
      }
      syncControls();
    } catch (error) {if (token !== loading) return;notice(`Could not open this episode: ${error.message}`);$('empty-title').textContent = 'This story needs a little help.';$('empty-desc').textContent = 'Check your files and refresh the library.';}
  }
  function updateTrackMenu() {
    refreshSecondaryIndex();
    $('german-source').textContent = !cues.length ? '' : current.id === 'demo' ? 'DE · Original practice sentences' : current.deTrack?.source ? `DE · ${current.deTrack.source}` : current.deSource === 'user' ? 'DE · Your imported subtitles' : 'DE · Imported subtitles';
    const menu = $('track-select');menu.replaceChildren();
    for (const [code,track] of Object.entries(tracks)) menu.add(new Option(`${code.toUpperCase()} · ${track.name || LANGUAGES[code] || code}`,code));
    if (!Object.keys(tracks).length) menu.add(new Option('No translation available',''));
    menu.value = Object.keys(tracks).length ? currentTrack : '';menu.disabled = !Object.keys(tracks).length;
    $('track-status').textContent = tracks[currentTrack] ? `${tracks[currentTrack].source || 'Imported'} · ${tracks[currentTrack].cues.length} cues` : 'Add a subtitle file or generate a translation.';
    $('panel-sub').textContent = cues.length ? `${cues.length} German sentences · click to replay` : 'Add German subtitles to enable sentence tools.';
  }
  function isSaved(id,cue) {return savedKeys.has(key(id,cue));}
  function toggleSaved(index) {
    const cue = cues[index];if (!cue) return toast('Add German subtitles, then select a sentence.');
    const identity = key(current.id,cue), found = state.saved.findIndex(item => item.key === identity);
    if (found >= 0) state.saved.splice(found,1);
    else state.saved.push({key:identity,episode:current.id,title:title(current.id),start:cue.start,end:cue.end,text:cue.text,translation:translations[index] || '',language:currentTrack,created:Date.now()});
    persist();updateStats();updateStar(index);if (savedMode) renderSaved();
    toast(found >= 0 ? 'Sentence removed.' : 'Sentence saved to your collection.');
  }
  function updateStar(index) {
    const saved = cues[index] && isSaved(current.id,cues[index]);
    const row = rowNodes.get(index), star = row?.querySelector('.line-star');
    if (star) {star.textContent = saved ? '★' : '☆';star.classList.toggle('starred',!!saved);star.setAttribute('aria-pressed',String(!!saved));star.setAttribute('aria-label',saved ? 'Unsave sentence' : 'Save sentence');}
    const target = active >= 0 ? active : selected;
    if (target === index) {$('save-current').textContent = saved ? '★' : '☆';$('save-current').setAttribute('aria-pressed',String(!!saved));$('player-save').firstChild.textContent = saved ? '★ ' : '☆ ';$('player-save').setAttribute('aria-pressed',String(!!saved));$('player-save').setAttribute('aria-label',saved ? 'Unsave current sentence' : 'Save current sentence');}
  }
  function renderLines(force = false) {
    const target = active >= 0 ? active : selected;
    const start = filter ? 0 : Math.max(0,Math.floor(Math.max(0,target - 15)/50)*50);
    if (!force && start === renderedStart) return;
    renderedStart = start;rowNodes = new Map();const fragment = document.createDocumentFragment();
    const indices = filter ? cues.map((cue,i) => i).filter(i => `${cues[i].text} ${translations[i]}`.toLocaleLowerCase().includes(filter)) : Array.from({length:Math.min(80,cues.length-start)},(_,i) => start+i);
    const info = el('div','transcript-count',filter ? `${indices.length} matches${indices.length > 100 ? ' · first 100 shown' : ''}` : `${cues.length ? start+1 : 0}–${Math.min(start+80,cues.length)} of ${cues.length}`);
    fragment.append(info);
    if (!filter && start > 0) {const previous = el('button','load-lines','↑ Earlier sentences');previous.dataset.window = String(Math.max(0,start-50));fragment.append(previous);}
    for (const i of indices.slice(0,100)) {
      const cue = cues[i], row = el('div',`line${i === active ? ' current' : ''}`);row.dataset.index = String(i);
      const jump = el('button','line-jump');jump.dataset.jump = String(i);jump.setAttribute('aria-label',`Replay sentence at ${format(cue.start+offset())}: ${cue.text}`);
      const text = el('div','line-text');text.append(el('div','line-de',cue.text));text.lastChild.lang = 'de';
      if (translations[i]) {const translated = el('div','line-trans',translations[i]);translated.dir = 'auto';translated.lang = currentTrack;translated.hidden = !state.settings.showSecond;text.append(translated);}
      jump.append(el('span','line-time',format(cue.start+offset())),text);
      const star = el('button',`line-star${isSaved(current.id,cue) ? ' starred' : ''}`,isSaved(current.id,cue) ? '★' : '☆');star.dataset.star = String(i);star.setAttribute('aria-label','Save sentence');star.setAttribute('aria-pressed',String(isSaved(current.id,cue)));
      row.append(jump,star);fragment.append(row);rowNodes.set(i,row);
    }
    if (!filter && start+80 < cues.length) {const next = el('button','load-lines','Later sentences ↓');next.dataset.window = String(start+50);fragment.append(next);}
    if (!indices.length) fragment.append(el('p','no-lines',filter ? 'No matching sentences. Try another word.' : 'No German subtitles yet. Add an SRT or VTT file to replay and save sentences.'));
    $('lines').replaceChildren(fragment);updateStar(target);
  }
  function updateCaptions() {
    const captionIndex = S.at(cueIndex,(video.currentTime || 0)-offset());
    const secondary = tracks[currentTrack]?.cues || [];
    // Translation uses its own timeline, including moments without a German cue.
    const secondaryAt = secondary.length ? S.at(secondaryIndex,(video.currentTime || 0)-secondOffset()) : -1;
    const german = captionIndex >= 0 ? cues[captionIndex].text : '';
    const translated = secondaryAt >= 0 ? secondary[secondaryAt].text : '';
    if ($('caption-de').textContent !== german) $('caption-de').textContent = german;
    if ($('caption-second').textContent !== translated) $('caption-second').textContent = translated;
    $('caption-second').lang = currentTrack;
    $('caption-second').hidden = state.settings.captionMode !== 'dual' || !state.settings.showSecond;
    $('caption-overlay').hidden = !loadedVideo || state.settings.captionMode === 'off' || (!german && (!translated || state.settings.captionMode !== 'dual' || !state.settings.showSecond));
  }
  let secondaryIndex = S.index([]);
  function refreshSecondaryIndex() {secondaryIndex = S.index(tracks[currentTrack]?.cues || []);}
  function tick(force = false) {
    if (!loadedVideo) return;
    const time = video.currentTime, cueTime = time-offset();
    let nextActive = S.at(cueIndex,cueTime);
    const pinned = cues[loopIndex];
    if (pinned && !video.paused && cueTime >= pinned.end-0.035) {video.currentTime = Math.max(0,pinned.start+offset());nextActive = loopIndex;}
    else if (state.settings.autoPause && !video.paused && active >= 0 && active !== suppressAutoPause && cueTime >= cues[active].end-0.035 && cueTime <= cues[active].end+0.6) {suppressAutoPause = active;video.pause();}
    if (nextActive !== active || force) {
      rowNodes.get(active)?.classList.remove('current');active = nextActive;
      if (active >= 0) {
        selected = active;if (state.settings.autoFollow && !filter) renderLines();const row = rowNodes.get(active);row?.classList.add('current');
        if (row && state.settings.autoFollow && !filter && !savedMode) {const bounds = row.getBoundingClientRect(), panel = $('lines').getBoundingClientRect();if (bounds.top < panel.top || bounds.bottom > panel.bottom) $('lines').scrollTop += bounds.top-panel.top-30;}
      }
      updateStar(active >= 0 ? active : selected);
    }
    updateCaptions();
    const now = performance.now();

    if (now-lastSaved > 5000) {saveProgress();lastSaved = now;}
  }
  function scheduleFrame() {
    cancelFrame();
    const frame = () => {frameHandle = null;tick();if (!video.paused && !video.ended) frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);};
    if (!video.paused) frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
  }
  function cancelFrame() {if (frameHandle !== null) {if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);else cancelAnimationFrame(frameHandle);frameHandle = null;}}
  function saveProgress() {
    if (!loadedVideo || !Number.isFinite(video.duration)) return;
    const previous = state.progress[current.id];
    if (previous?.time === video.currentTime && previous.duration === video.duration) return;
    state.progress[current.id] = {time:video.currentTime,duration:video.duration,updated:Date.now()};
    remote?.saveProgress(state.progress);
    persist();
  }
  function syncControls() {
    for (const id of ['play','seek','speed','mute','volume','skip-back','skip-forward']) $(id).toggleAttribute('disabled',!loadedVideo);
    for (const id of ['previous','replay','next','loop','auto-pause','player-save']) $(id).disabled = !loadedVideo || !cues.length;
    $('fullscreen').toggleAttribute('disabled',!loadedVideo || !document.fullscreenEnabled);
    const nextID = current.id === 'demo' ? C.inCollection(state.settings.collection)[0]?.id : C.next(current.id);
    $('next-episode').disabled = !meta(nextID).hasVideo;$('next-episode').dataset.next = nextID;
  }
  async function play() {if (!loadedVideo) return toast('Add a local video first.');try {await video.play();} catch {toast('Playback could not start. Try an MP4 with H.264 video and AAC audio.');}}
  function jump(index,shouldPlay = true) {
    if (!cues.length) return toast('Add German subtitles to use sentence replay.');
    index = Math.max(0,Math.min(cues.length-1,index));selected = index;suppressAutoPause = -1;
    if (loopIndex >= 0) loopIndex = index;
    if (!loadedVideo) {active = index;renderLines(true);return toast('Sentence selected. Add a video to hear it.');}
    video.currentTime = Math.max(0,Math.min(video.duration,cues[index].start+offset()));tick(true);if (shouldPlay) play();
  }
  function nearby(direction) {const time = (video.currentTime || 0)-offset();const currentIndex = active >= 0 ? active : Math.max(0,S.upperBound(cues,time)-1);jump(currentIndex+direction);}
  function syncLoop() {$('loop').classList.toggle('on',loopIndex >= 0);$('loop').setAttribute('aria-pressed',String(loopIndex >= 0));}
  function toggleLoop() {if (!cues.length) return toast('Add German subtitles to loop a sentence.');loopIndex = loopIndex >= 0 ? -1 : active >= 0 ? active : selected;syncLoop();if (loopIndex >= 0) jump(loopIndex);}
  function showSecond() {state.settings.showSecond = !state.settings.showSecond;persist();$('toggle-second').setAttribute('aria-pressed',String(state.settings.showSecond));$('toggle-second').title = state.settings.showSecond ? 'Hide translation (T)' : 'Show translation (T)';$('toggle-second').setAttribute('aria-label',$('toggle-second').title);renderLines(true);updateCaptions();}
  function view(saved) {navigate(saved ? 'saved' : 'watch');}
  const pages = {
    home:['A LITTLE EVERY DAY','Welcome back','A good story is a good place to start.','OVERVIEW'],
    welcome:['YOUR PERSONAL LANGUAGE STUDIO','Make yourself at home','A little German. A little more, every day.','WELCOME GUIDE'],
    watch:['LISTEN CLOSELY. STAY CURIOUS.','A story worth learning','Watch, replay, and make every sentence yours.','WATCH & LEARN'],
    saved:['YOUR GROWING GERMAN','Words worth keeping','The sentences you’ll want to say again.','SENTENCE COLLECTION']
  };
  function renderPage(next,focus = false) {
    page = Object.hasOwn(pages,next) ? next : 'home';savedMode = page === 'saved';document.body.dataset.page = page;
    for (const name of Object.keys(pages)) $(`${name}-view`).hidden = name !== page;
    document.querySelectorAll('[data-view]').forEach(button => {const activePage = button.dataset.view === page;button.classList.toggle('active',activePage);if (button.closest('nav') || button.classList.contains('nav')) {if (activePage) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}});
    const [eyebrow,heading,description,crumb] = pages[page];$('page-eyebrow').textContent = eyebrow;$('page-title').replaceChildren(document.createTextNode(heading),el('span','','.'));$('page-description').textContent = description;$('breadcrumb').textContent = crumb;
    document.title = `${crumb.toLowerCase().replace(/\b\w/g,c => c.toUpperCase())} · Sprechzimmer`;
    if (page !== 'watch') video.pause();
    if (page === 'home') renderDashboard();if (savedMode) renderSaved();
    if (page === 'welcome') $('welcome-language').value = state.settings.mother;
    if (focus) {window.scrollTo({top:0,behavior:'instant'});$('main-content').focus({preventScroll:true});}
  }
  function navigate(next,{replace = false,focus = true} = {}) {
    if (!Object.hasOwn(pages,next)) next = 'home';
    if (location.hash !== `#${next}`) history[replace ? 'replaceState' : 'pushState'](null,'',`#${next}`);
    renderPage(next,focus);
  }
  function renderDashboard() {
    const available = C.episodes.map(episode => episode.id).filter(id => meta(id).hasVideo);
    continueID = P.continueEpisode(state.progress,available,state.last);
    const continueEntry = C.get(continueID), progress = state.progress[continueID], resuming = progress?.time > 0 && progress.time < progress.duration*0.95;
    $('continue-tag').textContent = resuming ? 'PICK UP WHERE YOU LEFT OFF' : available.length ? `${available.length} EPISODES · READY TO WATCH` : 'YOUR FIRST LITTLE STEP';
    $('continue-title').textContent = continueID === 'demo' ? 'A little German, every day.' : `${continueEntry.seriesTitle}.`;
    if (continueID !== 'demo') $('continue-tag').textContent = `SEASON ${String(continueEntry.season).padStart(2,'0')} · EPISODE ${String(continueEntry.number).padStart(2,'0')} · ${resuming ? 'CONTINUE' : 'READY TO WATCH'}`;
    $('continue-description').textContent = continueID === 'demo' ? 'Try the silent practice clip, or add a German story of your own.' : 'A familiar story, a new way to listen. German audio, with subtitles at your pace.';
    $('continue-watch').replaceChildren(document.createTextNode(resuming ? 'Continue watching ' : 'Start watching '),el('span','','↗'));
    $('continue-position').textContent = resuming ? `${format(progress.time)} / ${format(progress.duration)} · Your place is saved` : continueID === 'demo' ? 'Silent practice · 40 seconds' : `Season ${String(continueEntry.season).padStart(2,'0')} · German dub · Available captions`;
    $('dashboard-language').textContent = state.settings.mother.toUpperCase();
    $('stat-started').textContent = Object.entries(state.progress).filter(([id,p]) => id !== 'demo' && p.time > 0).length;
    $('stat-saved').textContent = state.saved.length;$('stat-reviewed').textContent = state.reviews;
    $('practice-description').textContent = state.saved.length ? `${state.saved.length} sentences in your collection. Give a few of them another moment today.` : 'Star a sentence while watching. Your personal practice collection starts there.';
    $('dashboard-review').textContent = state.saved.length ? 'Practice your sentences →' : 'Find your first sentence →';
    const start = Math.max(0,available.indexOf(continueID)), suggestions = [...available.slice(start),...available.slice(0,start)].slice(0,3), fragment = document.createDocumentFragment();
    if (!suggestions.length) {const empty = el('p','no-lines','Your library is ready for its first story. Add a video from Watch & learn.');fragment.append(empty);}
    for (const id of suggestions) {
      const entry = C.get(id);
      const button = el('button','dashboard-episode');button.dataset.episode = id;button.setAttribute('aria-label',`Open ${entry.seriesTitle} season ${entry.season} episode ${entry.number}`);
      const art = el('div','episode-art');art.setAttribute('aria-hidden','true');art.append(el('span','episode-art-number',id.slice(-2)),el('span','episode-art-play','▶'));
      const info = el('div','dashboard-episode-info');info.append(el('small','',`${entry.seriesTitle.toUpperCase()} · SEASON ${String(entry.season).padStart(2,'0')}`),el('strong','',`Episode ${id.slice(-2)}`),el('span','',`● Local video · ${[...meta(id).available].map(c => c.toUpperCase()).join(' / ') || 'No subtitles'}`));
      button.append(art,info);fragment.append(button);
    }
    $('dashboard-episodes').replaceChildren(fragment);
    const collections = document.createDocumentFragment();
    for (const collection of C.collections) {
      const entries = C.inCollection(collection.id), ready = entries.filter(entry => meta(entry.id).hasVideo).length;
      const card = el('button',`collection-card collection-${collection.series}`);card.dataset.collection = collection.id;
      card.append(el('span','collection-symbol',collection.symbol));
      const copy = el('span','collection-copy');copy.append(el('strong','',collection.name),el('small','',`Season ${String(collection.season).padStart(2,'0')} · ${ready} / ${entries.length} videos ready`));const coverage = subtitleCoverage(entries);copy.append(el('small','collection-languages',coverage.map(([code,total]) => `${code.toUpperCase()} ${total}/${entries.length}`).join(' · ') || 'No subtitles available yet'));card.append(copy,el('span','collection-arrow','↗'));collections.append(card);
    }
    $('dashboard-collections').replaceChildren(collections);
  }
  function updateStats() {savedKeys = new Set(state.saved.map(item => item.key));$('saved-count').textContent = state.saved.length;$('learning-stats').textContent = `${state.saved.length} saved · ${state.reviews} practiced`;renderDashboard();}
  function applyTheme() {
    const dark = state.settings.theme === 'dark' || state.settings.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';$('theme-label').textContent = dark ? 'Light mode' : 'Dark mode';$('theme-toggle').setAttribute('aria-label',`Switch to ${dark ? 'light' : 'dark'} mode`);
    document.querySelector('meta[name="theme-color"]').content = dark ? '#080808' : '#ffffff';
  }
  function renderSaved() {
    const filter = $('saved-search').value.trim().toLocaleLowerCase(), fragment = document.createDocumentFragment();
    const list = state.saved.filter(item => `${item.text} ${item.translation} ${item.title}`.toLocaleLowerCase().includes(filter));
    for (const item of list) {
      const card = el('article','saved-card');card.append(el('small','ep-num',`${item.title} · ${format(item.start)} · ${(item.language || '').toUpperCase()}`),el('p','saved-german',item.text));
      const translation = el('p','saved-translation',item.translation || 'No translation saved.');translation.dir = 'auto';card.append(translation);
      const actions = el('div','saved-card-actions'), open = el('button','text-button','↗ Replay in video'), remove = el('button','text-button','★ Remove');open.dataset.savedJump = item.key;remove.dataset.remove = item.key;actions.append(open,remove);card.append(actions);fragment.append(card);
    }
    if (!list.length) {const empty = el('div','saved-empty');empty.append(el('div','sparkle','☆'),el('h3','',filter ? 'No matching sentences.' : 'Your next favorite sentence is waiting.'),el('p','',filter ? 'Try a different word.' : 'Star a sentence in the transcript and it will be here for practice.'));fragment.append(empty);}
    $('saved-list').replaceChildren(fragment);$('review-open').disabled = !state.saved.length;
  }
  async function openSaved(item) {
    view(false);await loadEpisode(item.episode,item.start+(state.timing[item.episode]?.de || 0));
    selected = Math.max(0,cues.findIndex(cue => cue.start === item.start && cue.text === item.text));
    if (loadedVideo) jump(selected);
    else if (video.getAttribute('src')) {const token = loading,index = selected;video.addEventListener('loadedmetadata',() => {if (token === loading) jump(index);},{once:true});}
    else if (cues.length) jump(selected,false);
    else toast('Add this episode’s video and German subtitles to replay it.');
  }
  function openImport() {$('import-episode').value = current.id === 'demo' ? C.inCollection(state.settings.collection)[0].id : current.id;$('import-status').textContent = '';for (const id of ['video-file','de-file','second-file']) $(id).value = '';$('import-dialog').showModal();}
  async function importFiles() {
    const id = $('import-episode').value, file = $('video-file').files[0], deFile = $('de-file').files[0], second = $('second-file').files[0], language = $('language-name').value;
    if (!file && !deFile && !second) {$('import-status').textContent = 'Choose at least one file.';return;}
    $('import-save').disabled = true;$('import-status').textContent = 'Saving locally…';
    try {
      const original = localEpisodes.get(id) || {id,tracks:{}};
      const episode = {...original,tracks:{...original.tracks}};
      if (file) {if (!/\.(mp4|webm|m4v)$/i.test(file.name)) throw new Error('Choose an MP4, WebM, or M4V video.');episode.hasVideo = true;episode.videoName = file.name;}
      const encoding = $('subtitle-encoding').value;
      if (deFile) {episode.de = await readSubtitles(deFile,'de',encoding);episode.deSource = 'user';delete episode.deRevision;}
      if (second) episode.tracks[language] = {code:language,name:LANGUAGES[language],source:'Imported subtitle file',cues:await readSubtitles(second,language,encoding)};
      await store.save(episode,file);localEpisodes.set(id,episode);
      if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
      state.settings.mother = language;persist();$('import-dialog').close();notice('');view(false);await loadEpisode(id);toast('Files added to your local library.');
    } catch (error) {$('import-status').textContent = error.name === 'QuotaExceededError' ? 'Storage is full. Put large videos in the media folder instead.' : error.message;}
    finally {$('import-save').disabled = false;}
  }
  async function openTranslate() {
    $('translate-dialog').showModal();$('translate-status').textContent = '';$('translate-language').value = state.settings.mother;$('ai-status').textContent = 'Checking local AI…';$('translate-start').disabled = true;
    try {const response = await fetch('/api/ai/status');const data = await response.json();aiAvailable = data.available;$('ai-status').textContent = aiAvailable ? `Ready · ${data.model} · runs on this computer` : 'Local AI is not running. Start Ollama and install a multilingual model, then reopen this window. See README for setup.';$('translate-start').disabled = !aiAvailable || !cues.length;if (!cues.length) $('translate-status').textContent = 'Add German subtitles first.';}
    catch {$('ai-status').textContent = 'Cannot reach the local server.';}
  }
  async function generateTranslation() {
    if (translationJob || !aiAvailable || !cues.length) return;
    const episodeID = current.id, language = $('translate-language').value, sourceCues = structuredClone(cues), sourceKind = current.deSource, sourceRevision = current.deRevision;
    if (tracks[language]?.cues?.length === sourceCues.length && tracks[language]?.source?.startsWith('AI generated')) {toast('An AI track already exists for this language. Export it or choose another language.');return;}
    const controller = new AbortController();translationJob = controller;$('translate-start').disabled = true;$('translate-cancel').disabled = false;$('translate-language').disabled = true;$('translate-progress').hidden = false;$('translate-progress').max = sourceCues.length;$('translate-progress').value = 0;
    const translated = [];
    try {
      for (let i = 0;i < sourceCues.length;i += 8) {
        $('translate-status').textContent = `Translating ${i+1}–${Math.min(i+8,sourceCues.length)} of ${sourceCues.length}…`;
        const batch = sourceCues.slice(i,i+8);
        const response = await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({language,texts:batch.map(cue => cue.text)})});
        const data = await response.json();if (!response.ok) throw new Error(data.error || 'Translation failed.');
        translated.push(...batch.map((cue,j) => ({...cue,text:data.translations[j]})));$('translate-progress').value = translated.length;
      }
      const episode = structuredClone(localEpisodes.get(episodeID) || {id:episodeID,tracks:{}});
      if (!episode.de?.length) {episode.de = sourceCues;episode.deSource = sourceKind || 'copied-from-folder';episode.deRevision = sourceRevision;}
      episode.tracks ||= {};episode.tracks[language] = {code:language,name:LANGUAGES[language],source:'AI generated · local Ollama',cues:translated};
      await store.save(episode);localEpisodes.set(episodeID,episode);state.settings.mother = language;persist();
      if (current.id === episodeID) {tracks[language] = episode.tracks[language];currentTrack = language;updateTrackMenu();refreshSecondaryIndex();alignTracks();renderLines(true);updateCaptions();}
      renderLibrary();$('translate-status').textContent = `Done. ${translated.length} translated cues saved locally.`;toast('Translation ready. You can export it as SRT.');
    } catch (error) {$('translate-status').textContent = error.name === 'AbortError' ? 'Translation cancelled. Your existing tracks are unchanged.' : error.message;}
    finally {translationJob = null;$('translate-start').disabled = false;$('translate-cancel').disabled = true;$('translate-language').disabled = false;}
  }
  function review() {
    if (!state.saved.length) return toast('Save a sentence to start practicing.');
    reviewDeck = [...state.saved].sort(() => Math.random()-0.5);reviewIndex = 0;renderReview();$('review-dialog').showModal();
  }
  function renderReview() {const item = reviewDeck[reviewIndex];$('review-progress').textContent = `${reviewIndex+1} / ${reviewDeck.length} · ${item.title}`;$('review-german').textContent = item.text;$('review-translation').textContent = item.translation || 'No translation was available when this sentence was saved.';$('review-translation').hidden = true;$('review-reveal').disabled = false;$('review-next').textContent = reviewIndex+1 === reviewDeck.length ? 'Finish practice ✓' : 'Next sentence →';}
  function exportBackup() {
    saveProgress();
    const episodes = [...localEpisodes.values()].map(({id,de,deSource,deRevision,tracks}) => ({id,de,deSource,deRevision,tracks}));
    // Include loaded folder tracks too, without serializing videos.
    if (current.id !== 'demo') {const existing = episodes.find(item => item.id === current.id);if (existing) {existing.de = cues;existing.deSource = current.deSource;existing.deRevision = current.deRevision;existing.tracks = tracks;} else episodes.push({id:current.id,de:cues,deSource:current.deSource,deRevision:current.deRevision,tracks});}
    const now = new Date(),day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    download(`sprechzimmer-backup-${day}.json`,JSON.stringify({format:'sprechzimmer',version:1,state,episodes},null,2),'application/json');
  }
  function validateCues(list) {return Array.isArray(list) && list.length <= 30000 && list.every(cue => cue && Number.isFinite(cue.start) && cue.start >= 0 && Number.isFinite(cue.end) && cue.end > cue.start && typeof cue.text === 'string' && cue.text.length <= 8000) && list.every((cue,i) => !i || cue.start >= list[i-1].start);}
  async function restoreBackup() {
    const file = $('backup-file').files[0];if (!file) return $('backup-status').textContent = 'Choose a backup JSON file first.';
    try {
      if (file.size > 30_000_000) throw new Error('Backup must be smaller than 30 MB.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'sprechzimmer' || data.version !== 1 || !data.state || !Array.isArray(data.state.saved) || !Array.isArray(data.episodes) || data.episodes.length > C.episodes.length+1 || data.state.saved.length > 30000) throw new Error('This is not a supported Sprechzimmer backup.');
      const validID = id => id === 'demo' || !!C.get(id);
      const episodes = [];
      for (const item of data.episodes) {
        if (!item || !validID(item.id) || (item.de && !validateCues(item.de)) || !item.tracks || typeof item.tracks !== 'object') throw new Error('Invalid episode or subtitle data.');
        const original = localEpisodes.get(item.id) || {id:item.id,tracks:{}};
        const episode = {...original,tracks:{...original.tracks}};
        if (item.de) {episode.de = item.de;episode.deSource = ['user','user-edited'].includes(item.deSource) ? item.deSource : 'restored';episode.deRevision = typeof item.deRevision === 'string' ? item.deRevision.slice(0,96) : undefined;}
        for (const [code,track] of Object.entries(item.tracks)) {if (!Object.hasOwn(LANGUAGES,code) || !validateCues(track.cues)) throw new Error('Invalid subtitle track.');episode.tracks[code] = {code,name:LANGUAGES[code],source:String(track.source || 'Restored').slice(0,100),cues:track.cues};}
        episodes.push(episode);
      }
      const saved = data.state.saved.map(item => {
        if (!item || !validID(item.episode) || typeof item.text !== 'string' || !item.text || item.text.length > 8000 || !Number.isFinite(item.start) || item.start < 0 || !Number.isFinite(item.end) || item.end <= item.start || (item.translation && typeof item.translation !== 'string')) throw new Error('Invalid saved sentence.');
        return {key:key(item.episode,item),episode:item.episode,title:title(item.episode),start:item.start,end:item.end,text:item.text,translation:(item.translation || '').slice(0,8000),language:Object.hasOwn(LANGUAGES,item.language) ? item.language : 'ar',created:Number(item.created) || Date.now()};
      });
      const mergedProgress = {...state.progress};
      for (const [id,entry] of Object.entries(data.state.progress || {})) {if (validID(id) && entry && Number.isFinite(entry.time) && entry.time >= 0 && Number.isFinite(entry.duration) && entry.duration >= entry.time && (!mergedProgress[id] || (entry.updated || 0) > (mergedProgress[id].updated || 0))) mergedProgress[id] = {time:entry.time,duration:entry.duration,updated:Number(entry.updated) || 0};}
      await store.saveMany(episodes);for (const episode of episodes) localEpisodes.set(episode.id,episode);
      state.saved = [...new Map([...state.saved,...saved].map(item => [item.key,item])).values()];state.progress = mergedProgress;
      const settings = data.state.settings || {};
      if (Object.hasOwn(LANGUAGES,settings.mother)) state.settings.mother = settings.mother;
      if ([0.5,0.75,1,1.25,1.5,2].includes(settings.speed)) state.settings.speed = settings.speed;
      if (['dual','german','off'].includes(settings.captionMode)) state.settings.captionMode = settings.captionMode;
      for (const name of ['showSecond','autoPause','autoFollow']) if (typeof settings[name] === 'boolean') state.settings[name] = settings[name];
      if (C.collections.some(collection => collection.id === settings.collection)) state.settings.collection = settings.collection;
      if (settings.captions) state.settings.captions = CS.sanitize(settings.captions);
      if (['system','light','dark'].includes(settings.theme)) state.settings.theme = settings.theme;
      if (Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1) state.settings.volume = settings.volume;
      if (typeof settings.muted === 'boolean') state.settings.muted = settings.muted;
      for (const [id,value] of Object.entries(data.state.timing || {})) {
        if (!validID(id) || !value || !Number.isFinite(value.de) || Math.abs(value.de) > 120) continue;
        const timings = {};for (const [code,delay] of Object.entries(value.tracks || {})) if (Object.hasOwn(LANGUAGES,code) && Number.isFinite(delay) && Math.abs(delay) <= 120) timings[code] = delay;
        state.timing[id] = {de:value.de,tracks:timings};
        if (/^[a-f0-9]{64}$/.test(value.deReference || '')) state.timing[id].deReference = value.deReference;
      }
      state.reviews = Math.max(state.reviews,Number.isSafeInteger(data.state.reviews) && data.state.reviews > 0 ? data.state.reviews : 0);
      remote?.saveProgress(state.progress);
      persist();applySettings();updateStats();renderLibrary();renderSaved();await loadEpisode(current.id);$('backup-status').textContent = 'Backup restored. Videos already on this device were preserved.';
    } catch (error) {$('backup-status').textContent = `Could not restore: ${error.message}`;}
  }
  function applySettings() {
    $('caption-mode').value = state.settings.captionMode;$('auto-follow').checked = state.settings.autoFollow;
    $('auto-pause').classList.toggle('on',state.settings.autoPause);$('auto-pause').setAttribute('aria-pressed',String(state.settings.autoPause));$('toggle-second').setAttribute('aria-pressed',String(state.settings.showSecond));video.playbackRate = state.settings.speed;
    $('player-caption-mode').value = state.settings.captionMode;
    video.volume = Number.isFinite(state.settings.volume) ? Math.max(0,Math.min(1,state.settings.volume)) : 1;video.muted = !!state.settings.muted;applyTheme();applyCaptionAppearance();
  }
  function toggleMute() {if (video.muted || video.volume === 0) {video.muted = false;if (!video.volume) video.volume = 0.5;} else video.muted = true;}
  function setCaptionMode(mode) {state.settings.captionMode = mode;$('caption-mode').value = mode;$('player-caption-mode').value = mode;persist();updateCaptions();}
  function seekBy(delta) {if (!loadedVideo) return;loopIndex = -1;syncLoop();suppressAutoPause = -1;video.currentTime = P.seek(video.currentTime,delta,video.duration);tick(true);feedback(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} seconds`);}
  function setSpeed(value) {state.settings.speed = value;video.playbackRate = value;persist();feedback(`${value}× speed`);}
  function toggleFullscreen() {$('fullscreen').click();}
  async function openEpisode(id) {navigate('watch');notice('');if (current.id !== id) await loadEpisode(id);}
  const captionFields = {'caption-font':'font','caption-size':'scale','caption-color':'color','caption-second-color':'secondColor','caption-background':'background','caption-background-opacity':'backgroundOpacity','caption-text-opacity':'textOpacity','caption-edge':'edge'};
  let captionSaveTimer;
  function applyCaptionAppearance() {
    const style = CS.sanitize(state.settings.captions);state.settings.captions = style;
    for (const host of [$('player'),$('caption-preview')]) for (const [name,value] of Object.entries(CS.variables(style))) host.style.setProperty(name,value);
    for (const [id,key] of Object.entries(captionFields)) $(id).value = style[key];
  }
  function openCaptionAppearance() {
    video.pause();applyCaptionAppearance();const dialog = $('caption-dialog');
    if (document.fullscreenElement && !document.fullscreenElement.contains(dialog)) {dialog.dataset.restoreParent = 'true';dialog.slot = 'dialog';dialog.setAttribute('noautohide','');document.fullscreenElement.append(dialog);}
    dialog.showModal();
  }
  for (const [id,key] of Object.entries(captionFields)) $(id).addEventListener('input',() => {state.settings.captions = CS.sanitize({...state.settings.captions,[key]:$(id).value});applyCaptionAppearance();clearTimeout(captionSaveTimer);captionSaveTimer=setTimeout(persist,150);});
  for (const id of ['player-caption-style','caption-style-open']) $(id).onclick = openCaptionAppearance;
  $('caption-style-reset').onclick = () => {state.settings.captions = {...CS.defaults};applyCaptionAppearance();persist();};
  $('caption-dialog').addEventListener('close',() => {persist();const dialog=$('caption-dialog');if(dialog.dataset.restoreParent){document.body.append(dialog);dialog.removeAttribute('slot');delete dialog.dataset.restoreParent;}});
  // Delegated events keep the transcript and episode library inexpensive to rebuild.
  for (const id of ['episodes','dashboard-episodes']) $(id).addEventListener('click',event => {const button = event.target.closest('[data-episode]');if (button) openEpisode(button.dataset.episode);});
  $('lines').addEventListener('click',event => {const star = event.target.closest('[data-star]'), row = event.target.closest('[data-jump]'), windowButton = event.target.closest('[data-window]');if (star) toggleSaved(+star.dataset.star);else if (row) jump(+row.dataset.jump);else if (windowButton) {selected = +windowButton.dataset.window+15;const oldActive = active;active = -1;renderLines(true);active = oldActive;}});
  $('saved-list').addEventListener('click',event => {const open = event.target.closest('[data-saved-jump]'), remove = event.target.closest('[data-remove]');if (open) {const item = state.saved.find(item => item.key === open.dataset.savedJump);if (item) openSaved(item);}else if (remove) {state.saved = state.saved.filter(item => item.key !== remove.dataset.remove);persist();updateStats();renderSaved();renderLines(true);}});
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => navigate(button.dataset.view)));
  document.querySelector('.skip-link').addEventListener('click',event => {event.preventDefault();$('main-content').focus();$('main-content').scrollIntoView({block:'start'});});
  for (const id of ['backup-open','mobile-backup','footer-backup','welcome-backup']) $(id).onclick = () => $('backup-dialog').showModal();
  $('theme-toggle').onclick = () => {state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';persist();applyTheme();};
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',() => {if (state.settings.theme === 'system') applyTheme();});
  $('welcome-start').onclick = () => {state.welcomed = true;persist();navigate('home');};
  $('welcome-language').onchange = () => {
    state.settings.mother = $('welcome-language').value;persist();
    if (tracks[state.settings.mother]) {currentTrack = state.settings.mother;updateTrackMenu();alignTracks();renderLines(true);updateCaptions();$('second-offset').value = secondOffset();}
    renderDashboard();
  };
  $('collection-select').onchange = () => {state.settings.collection = $('collection-select').value;persist();renderLibrary();};
  $('dashboard-collections').addEventListener('click',event => {const button = event.target.closest('[data-collection]');if (!button) return;state.settings.collection = button.dataset.collection;persist();renderLibrary();navigate('watch');$('library-section').scrollIntoView({block:'start'});});
  $('continue-watch').onclick = () => openEpisode(continueID);
  $('dashboard-review').onclick = () => state.saved.length ? review() : openEpisode(continueID);
  $('browse-library').onclick = () => {navigate('watch');$('library-section').scrollIntoView({block:'start'});};
  window.addEventListener('popstate',() => renderPage(location.hash.slice(1),true));window.addEventListener('hashchange',() => renderPage(location.hash.slice(1),true));
  $('shortcut-btn').onclick = () => $('help-dialog').showModal();
  for (const id of ['import-open','empty-import']) $(id).onclick = openImport;
  $('import-save').onclick = importFiles;$('demo-open').onclick = () => openEpisode('demo');$('refresh-library').onclick = () => refreshFolder();$('ready-only').onchange = renderLibrary;
  $('replay').onclick = () => jump(active >= 0 ? active : selected);$('previous').onclick = () => nearby(-1);$('next').onclick = () => nearby(1);$('loop').onclick = toggleLoop;
  $('auto-pause').onclick = () => {state.settings.autoPause = !state.settings.autoPause;suppressAutoPause = -1;persist();applySettings();};
  $('player').addEventListener('dblclick',event => {if(!event.target.closest('.player-controls')) toggleFullscreen();});
  document.addEventListener('fullscreenchange',() => {if(!document.fullscreenElement && page==='watch') $('fullscreen').focus({preventScroll:true});});
  $('player-save').onclick = () => toggleSaved(active >= 0 ? active : selected);
  $('next-episode').onclick = () => openEpisode($('next-episode').dataset.next);
  $('save-current').onclick = () => toggleSaved(active >= 0 ? active : selected);$('toggle-second').onclick = showSecond;
  $('track-select').onchange = () => {currentTrack = $('track-select').value;state.settings.mother = currentTrack;persist();$('second-offset').value = secondOffset();updateTrackMenu();refreshSecondaryIndex();alignTracks();renderLines(true);updateCaptions();};
  let searchTimer;$('search').oninput = () => {clearTimeout(searchTimer);searchTimer = setTimeout(() => {filter = $('search').value.trim().toLocaleLowerCase();renderLines(true);},100);};
  for (const id of ['caption-mode','player-caption-mode']) $(id).onchange = () => setCaptionMode($(id).value);
  $('auto-follow').onchange = () => {state.settings.autoFollow = $('auto-follow').checked;persist();};
  for (const id of ['de-offset','second-offset']) $(id).onchange = () => {
    const value = Number($(id).value);if (!Number.isFinite(value) || Math.abs(value) > 120) {$(id).value = 0;return toast('Use a delay between −120 and 120 seconds.');}
    const entry = timing();entry.tracks ||= {};if (id === 'de-offset') entry.de = value;else entry.tracks[currentTrack] = value;state.timing[current.id] = entry;persist();alignTracks();renderLines(true);tick(true);
  };
  $('download-subs').onclick = () => {const track = tracks[currentTrack];if (!track?.cues?.length) return toast('No translated subtitles available to export.');download(`${current.id}.${currentTrack}.srt`,S.srt(track.cues),'text/plain;charset=utf-8');};
  $('translate-open').onclick = openTranslate;$('translate-start').onclick = generateTranslation;$('translate-cancel').onclick = () => translationJob?.abort();$('translate-dialog').addEventListener('close',() => translationJob?.abort());
  $('saved-search').oninput = renderSaved;$('review-open').onclick = review;$('review-reveal').onclick = () => {$('review-translation').hidden = false;$('review-reveal').disabled = true;};
  $('review-next').onclick = () => {state.reviews++;persist();updateStats();if (++reviewIndex >= reviewDeck.length) {$('review-dialog').close();toast('Practice complete. A little progress, well earned.');}else renderReview();};
  $('review-play').onclick = () => {const item = reviewDeck[reviewIndex];$('review-dialog').close();openSaved(item);};
  $('export-csv').onclick = () => {const cell = value => {const text = String(value || '');return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '')+text.replaceAll('"','""')}"`;};const rows = [['German','Translation','Language','Episode','Timestamp'],...state.saved.map(item => [item.text,item.translation,item.language,item.title,format(item.start)])];download('sprechzimmer-sentences.csv','\uFEFF'+rows.map(row => row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');};
  $('backup-export').onclick = exportBackup;$('backup-restore').onclick = restoreBackup;
  video.addEventListener('play',() => {syncControls();scheduleFrame();});video.addEventListener('pause',() => {cancelFrame();saveProgress();syncControls();renderLibrary();});video.addEventListener('timeupdate',() => tick());video.addEventListener('seeked',() => tick(true));video.addEventListener('ended',() => {if (loopIndex >= 0) jump(loopIndex);else {saveProgress();syncControls();}});
  video.addEventListener('volumechange',() => {state.settings.volume = video.volume;state.settings.muted = video.muted;persist();});
  video.addEventListener('ratechange',() => {state.settings.speed = video.playbackRate;persist();});
  video.addEventListener('error',() => {if (!video.getAttribute('src')) return;loadedVideo = false;$('player-empty').hidden = false;$('empty-title').textContent = 'This video could not be played.';$('empty-desc').textContent = 'Use an MP4 with H.264 video and AAC audio, or a WebM. Check that folder files still exist.';syncControls();});
  document.addEventListener('keydown',event => {
    const action = P.shortcut(event,{watching:page === 'watch',dialogOpen:!!document.querySelector('dialog[open]'),editing:!!event.target.closest('input:not([type="range"]),select,textarea,[contenteditable]:not([contenteditable="false"])'),nativeControl:!!event.target.closest('button,input[type="range"],media-control-bar'),rangeControl:!!event.target.closest('input[type="range"],media-time-range,media-volume-range')});
    if (!action || !loadedVideo) return;
    const actions = {play:() => video.paused ? play() : video.pause(),replay:() => jump(active >= 0 ? active : selected),back:() => seekBy(-5),forward:() => seekBy(5),previous:() => nearby(-1),next:() => nearby(1),save:() => toggleSaved(active >= 0 ? active : selected),loop:toggleLoop,translation:showSecond,fullscreen:toggleFullscreen,mute:toggleMute,captions:() => {const modes = ['dual','german','off'];setCaptionMode(modes[(modes.indexOf(state.settings.captionMode)+1)%3]);feedback(`Captions: ${state.settings.captionMode}`);},slower:() => setSpeed(P.speed(state.settings.speed,-1)),faster:() => setSpeed(P.speed(state.settings.speed,1))};
    event.preventDefault();actions[action]();
  });
  window.addEventListener('pagehide',saveProgress);document.addEventListener('visibilitychange',() => {if (document.hidden) saveProgress();});
  async function init() {
    for (const id of ['language-name','translate-language','welcome-language']) options($(id));
    for (const collection of C.collections) $('collection-select').add(new Option(`${collection.name} · Season ${String(collection.season).padStart(2,'0')}`,collection.id));
    for (const episode of C.episodes) $('import-episode').add(new Option(title(episode.id),episode.id));
    if (!C.collections.some(collection => collection.id === state.settings.collection)) state.settings.collection = C.collections[0].id;
    applySettings();updateStats();$('today-label').textContent = new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(new Date());
    const initialPage = location.hash.slice(1) || (state.welcomed || state.saved.length || Object.values(state.progress).some(p => p.time > 0) ? 'home' : 'welcome');
    navigate(initialPage,{replace:true,focus:false});
    try {localEpisodes = new Map((await store.all()).map(episode => [episode.id,episode]));} catch {notice('Browser storage is unavailable. Folder videos and the practice clip still work. Enable browser storage to import and save files.');}
    if (storageWarning) notice('Previous browser settings could not be read. You can restore an exported backup.');
    if (remote) {
      $('translate-open').hidden = true;
      await loadEpisode('demo');
      await remote.start({
        onOpen:() => video.pause(),
        onSync:message => {$('secure-open').title = message;},
        async onConnection(progress,message = '') {
          loadedVideo = false;
          video.pause();
          state.progress = {...progress};
          await refreshFolder(true);
          const next = P.continueEpisode(state.progress,[...folderEpisodes.keys()],state.last);
          await loadEpisode(next);
          notice(message);
        }
      });
    } else {
      await refreshFolder(true);
      await loadEpisode(C.get(state.last) ? state.last : 'demo');
    }
    refreshSecondaryIndex();
  }
  init().catch(error => notice(`Startup failed: ${error.message}`));
})();
