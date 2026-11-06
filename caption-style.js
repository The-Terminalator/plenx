'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CaptionStyle=api;})(typeof window!=='undefined'?window:globalThis,() => {
  const fonts={sans:"'Segoe UI',Tahoma,Arial,sans-serif",serif:"Georgia,'Times New Roman',serif",mono:"Consolas,'Courier New',monospace",rounded:"'Trebuchet MS',Tahoma,Arial,sans-serif",casual:"'Comic Sans MS',Tahoma,Arial,sans-serif"};
  const defaults={font:'sans',scale:1,color:'#ffffff',secondColor:'#eeeeee',background:'#000000',backgroundOpacity:0.75,textOpacity:1,edge:'shadow'};
  function sanitize(input={}) {
    if(!input||typeof input!=='object')input={};const value={...defaults};
    if(typeof input.font==='string'&&Object.hasOwn(fonts,input.font))value.font=input.font;
    if([0.75,1,1.25,1.5,1.75,2].includes(Number(input.scale)))value.scale=Number(input.scale);
    for(const key of ['color','secondColor','background'])if(typeof input[key]==='string'&&/^#[0-9a-f]{6}$/i.test(input[key]))value[key]=input[key].toLowerCase();
    if([0,0.25,0.5,0.75,1].includes(Number(input.backgroundOpacity))&&input.backgroundOpacity!==null)value.backgroundOpacity=Number(input.backgroundOpacity);
    if([0.5,0.75,1].includes(Number(input.textOpacity)))value.textOpacity=Number(input.textOpacity);
    if(['none','shadow','outline'].includes(input.edge))value.edge=input.edge;
    return value;
  }
  function rgba(hex,opacity){return `rgba(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',')},${opacity})`;}
  function variables(input) {
    const s=sanitize(input);return {'--caption-font':fonts[s.font],'--caption-scale':String(s.scale),'--caption-color':rgba(s.color,s.textOpacity),'--caption-second-color':rgba(s.secondColor,s.textOpacity),'--caption-background':rgba(s.background,s.backgroundOpacity),'--caption-shadow':{none:'none',shadow:'0 2px 4px #000, 0 0 2px #000',outline:'-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'}[s.edge]};
  }
  return {fonts,defaults,sanitize,variables};
});
