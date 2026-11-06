'use strict';
(function(root,factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.StoryCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis,() => {
  const collections = [
    {id:'simpsons-s06',series:'simpsons',name:'The Simpsons',season:6,count:25,description:'A familiar world. A little more German.',symbol:'✳'},
    {id:'spongebob-s03',series:'spongebob',name:'SpongeBob Schwammkopf',season:3,count:20,description:'A little German, under the sea.',symbol:'▧'},
    {id:'simpsons-s07',series:'simpsons',name:'The Simpsons',season:7,count:25,description:'More everyday German from Springfield.',symbol:'✳'},
    {id:'spongebob-s04',series:'spongebob',name:'SpongeBob Schwammkopf',season:4,count:20,description:'More stories from Bikini Bottom.',symbol:'▧'}
  ];
  const episodes = collections.flatMap(collection => Array.from({length:collection.count},(_,index) => {
    const number = index+1, code = `s${String(collection.season).padStart(2,'0')}e${String(number).padStart(2,'0')}`;
    const id = collection.id === 'simpsons-s06' ? code : `${collection.series}.${code}`;
    return {id,collection:collection.id,series:collection.series,seriesTitle:collection.name,season:collection.season,number,file:`${collection.series}.${code}`,label:`${collection.name} · S${String(collection.season).padStart(2,'0')} E${String(number).padStart(2,'0')}`};
  }));
  const byID = new Map(episodes.map(episode => [episode.id,episode]));
  const byFile = new Map(episodes.map(episode => [episode.file,episode]));
  function get(id) {return byID.get(id);}
  function inCollection(id) {return episodes.filter(episode => episode.collection === id);}
  function collection(id) {return collections.find(item => item.id === id) || collections[0];}
  function next(id) {const episode = get(id);return episode ? inCollection(episode.collection).find(item => item.number === episode.number+1)?.id : undefined;}
  function fromFile(name) {
    const match = name.match(/^(.+?)(?:\.([a-z]{2}))?\.(mp4|webm|m4v|srt|vtt)$/i);
    if (!match) return null;
    const episode = byFile.get(match[1].toLowerCase());
    return episode ? {episode,language:match[2]?.toLowerCase(),extension:match[3].toLowerCase()} : null;
  }
  return {collections,episodes,get,inCollection,collection,next,fromFile};
});
