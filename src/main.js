import './style.css';
import './promo.css';
import { defaults, factoryDefaults, sanitizeSettings } from './settings.js';
import { WinterScene } from './scene.js';
import { catalogProducts, mountCatalog } from './catalog-ui.js';

const $ = (s) => document.querySelector(s);
const STORAGE_KEY='winter-studio-v9';
const PROJECT_DRAFT_KEY='winter-studio-project-draft';
const PROJECT_PRESET_CACHE_KEY='winter-studio-project-preset';
const strongerSnowKeys=['snowfall','flakeSize','sprayAmount','spraySpread','spraySize','spraySpeed','sprayLifetime','sprayLift','sprayGravity','sprayMist','sprayTurbulence'];
function readSaved(key){try{const raw=localStorage.getItem(key);return raw?sanitizeSettings(JSON.parse(raw)):null;}catch{return null;}}
const differences=(values,baseline)=>Object.fromEntries(Object.entries(values).filter(([key,value])=>value!==baseline[key]));
const savedOverrides=readSaved(STORAGE_KEY);
let saved=savedOverrides ?? readSaved('winter-studio-v8');
if(!saved){
  const v7=readSaved('winter-studio-v7');
  const v6=readSaved('winter-studio-v6');
  const v5=readSaved('winter-studio-v5');
  const previous=readSaved('winter-studio-v4');
  if(v7){saved={...v7};}
  else if(v6){saved={...v6};}
  else if(v5){saved={...v5,rpm:factoryDefaults.rpm};}
  else if(previous){saved={...previous};for(const key of strongerSnowKeys)saved[key]=factoryDefaults[key];}
  else{
    const older=readSaved('winter-studio-v3');
    saved={};
    if(older){Object.assign(saved,older);for(const key of ['wheelPitch','wheelYaw','wheelTilt','wheelX','wheelZ','wheelScale',...strongerSnowKeys])saved[key]=factoryDefaults[key];}
    else for(const [key,value] of Object.entries(readSaved('winter-studio-v2')||{})){if(key.startsWith('rubber')||key.startsWith('rim')||key==='spokeStyle')saved[key]=value;}
  }
  if(!v7&&!v6)saved.rpm=factoryDefaults.rpm;
  for(const key of ['sprayAmount','spraySpread','spraySize','sprayLifetime','sprayLift','sprayGravity'])saved[key]=factoryDefaults[key];
}
if(!savedOverrides)saved=differences(saved,factoryDefaults);
const projectEditing=import.meta.env.DEV && ['127.0.0.1','localhost','[::1]'].includes(location.hostname);
const presetEndpoint='/__scene-preset';
const textureEndpoint='/__scene-textures';
const textureDirectory=new URL(`${import.meta.env.BASE_URL}project-textures/`,location.href);
const textureTargets=['snow','rubber','rim'];
const textureSlots=['map','bumpMap','roughnessMap'];
let textureBusy=false;
let projectPreset=null;
function rememberProjectPreset(preset){
  try{localStorage.setItem(PROJECT_PRESET_CACHE_KEY,JSON.stringify(preset));}catch{}
}
if(projectEditing){
  try {
    const response=await fetch(presetEndpoint);
    if(!response.ok)throw new Error();
    projectPreset=sanitizeSettings(await response.json());
    rememberProjectPreset(projectPreset);
    $('#preset-status').textContent='Зміни записуються в проєкт';
  } catch {
    projectPreset=readSaved(PROJECT_PRESET_CACHE_KEY);
    $('#preset-status').textContent='Показано останній збережений пресет';
  }
  $('#reset-all').textContent='Заводські значення';
}
const baseline=projectEditing&&projectPreset?{...factoryDefaults,...projectPreset}:defaults;
const projectDraft=projectEditing?(readSaved(PROJECT_DRAFT_KEY)??{}):{};
const settings={...baseline,...(projectEditing?{}:saved),...projectDraft};
let lastQueued={...baseline,...projectDraft}, pending=projectDraft, inFlight={}, saving=false, presetTimer;
let scene, activeTab='snow', hidden=true, toastTimeout;
const range=(key,label,min,max,step=0.01,unit='')=>({type:'range',key,label,min,max,step,unit});
const color=(key,label)=>({type:'color',key,label});
const toggle=(key,label)=>({type:'toggle',key,label});
const select=(key,label,options)=>({type:'select',key,label,options});
const panels={
  snow:{title:'Сніг та вітер',icon:'✳',label:'Сніг',intro:'Від тонкого шару на скелях до щільної хуртовини. Кожне значення можна ввести вручну.',sections:[
    {title:'Сніг на скелях',items:[color('snowColor','Відтінок снігу'),range('snowCover','Покриття скель',0,2,0.005),range('snowDepth','Товщина шару',0,0.2,0.001),range('snowGrain','Мікрорельєф',0,0.5,0.0005),range('snowScale','Дрібність зерна',0.1,300,0.1),range('snowRoughness','Матовість',0,1,0.005),range('snowSparkle','Іскріння кристалів',0,5,0.01),range('snowRelief','Сніг на гранях',0,3,0.005)]},
    {title:'Вітер і біла пелена',items:[range('windSpeed','Сила вітру',0,20,0.01),range('windDirection','Напрямок',-360,360,0.5,'°'),range('windVeil','Щільність пелени',0,2,0.005),range('veilScale','Масштаб хвиль',0.05,8,0.005)]},
    {title:'Снігопад і туман',items:[range('snowfall','Густота снігопаду',0,12,0.01),range('flakeSize','Розмір сніжинок',0.003,0.35,0.001),range('fallSpeed','Швидкість падіння',0,8,0.01),range('fog','Густота туману',0,0.15,0.0005)]},
    {title:'Накопичення та обсипання',items:[toggle('accumulationEnabled','Накопичувати сніг'),range('accumulationRate','Швидкість осідання',0,5,0.005),range('accumulationMax','Гранична товщина',0,0.3,0.001),range('snowAdhesion','Зчеплення снігу з шиною',0,1,0.005),range('snowShedding','Інтенсивність обсипання',0,5,0.005),{type:'action',id:'clear-snow',text:'Очистити накопичений сніг'}]},
    {title:'Власна текстура',closed:true,items:[{type:'upload',target:'snow'},range('snowTextureMix','Сила текстури',0,1,0.005),range('snowTextureRotation','Поворот текстури',-720,720,0.5,'°')]},
  ]},
  rocks:{
    title:'Скелі біля колеса',icon:'▲',label:'Скелі',
    intro:'Спільні налаштування для двох скель, що тримають колесо.',
    sections:[
      {title:'Камінь і лід',items:[
        color('rockColor','Відтінок каменю'),
        range('rockRoughness','Матовість каменю',0,1,0.005),
        range('rockIce','Крижаний блиск',0,1,0.005),
        range('rockBump','Мікрорельєф каменю',0,0.5,0.0005),
        range('rockTextureScale','Масштаб текстури',0.1,20,0.01),
      ]},
      {title:'Форма скель',items:[range('hillHeight','Рельєф скель',0.1,4,0.01)]},
    ],
  },
  clouds:{title:'Хмари над ущелиною',icon:'☁',label:'Хмари',intro:'Верхні й нижні пасма огортають і перекривають скелі. Колесо залишається відкритим.',sections:[
    {title:'Основні хмари',items:[range('cloudDensity','Щільність фону',0,2,0.005),range('cloudContrast','Контраст хмар',0,2,0.005),range('cloudSpeed','Швидкість руху',0,3,0.005)]},
    {title:'Хмари над скелями',items:[range('upperCloudDensity','Щільність зверху',0,2,0.005),range('upperCloudHeight','Висота верхнього шару',-1,9,0.01),range('upperCloudScale','Масштаб зверху',0.2,4,0.005)]},
    {title:'Хмари під скелями',items:[range('lowerCloudDensity','Щільність знизу',0,2,0.005),range('lowerCloudHeight','Висота нижнього шару',-9,1,0.01),range('lowerCloudScale','Масштаб знизу',0.2,4,0.005)]},
    {title:'Рух і вигляд шарів',items:[range('layerCloudSpeed','Швидкість шарів',0,3,0.005),range('layerCloudSoftness','М’якість країв',0,1,0.005),color('layerCloudColor','Відтінок хмар')]},
  ]},
  light:{title:'Освітлення',icon:'☼',label:'Світло',intro:'Напрямок сонця, холодне заповнення й контрове світло підкреслюють форму колеса.',sections:[
    {title:'Схеми світла',items:[{type:'presets',presets:[['overcast','Похмурий день'],['morning','Зимовий ранок'],['blue','Синя година'],['studio','Контрастне світло']]}]},
    {title:'Сонце',items:[range('sunIntensity','Інтенсивність',0,30,0.01),color('sunColor','Колір сонця'),range('sunAzimuth','Напрямок сонця',-360,360,0.5,'°'),range('sunElevation','Висота сонця',-15,90,0.5,'°')]},
    {title:'Заповнення та контур',items:[range('ambientIntensity','Розсіяне світло',0,12,0.01),color('ambientColor','Колір заповнення'),range('fillIntensity','Бічне заповнення',0,20,0.01),range('rimIntensity','Контрове світло',0,30,0.01)]},
    {title:'Небо та експозиція',items:[range('exposure','Експозиція',0.05,5,0.005),color('skyColor','Колір неба'),color('horizonColor','Колір горизонту'),range('backgroundLight','Яскравість неба',0,3,0.005)]},
    {title:'Тіні',items:[range('shadowSoftness','М’якість тіней',0,20,0.05),range('shadowOpacity','Контактна тінь',0,1,0.005)]},
  ]},
  wheel:{title:'Обертання від скролу',icon:'◎',label:'Колесо',intro:'Прокручуй над сценою, щоб обертати колесо. Зміни напрямок скролу для реверсу; після жесту колесо сповільниться.',sections:[
    {title:'Скрол та інерція',items:[range('scrollSensitivity','Чутливість скролу',0.05,5,0.005),range('scrollInertia','Інерція обертання',0.1,5,0.005,'с'),range('rpm','Межа швидкості',10,600,0.1,'об/хв'),{type:'action',id:'stop-wheel',text:'Зупинити колесо'}]},
    {title:'Сніг з-під протектора',items:[range('sprayAmount','Інтенсивність викиду',0,12,0.01),range('spraySpread','Ширина шлейфу',0.05,5,0.005),range('spraySize','Розмір частинок',0.1,4,0.005),range('spraySpeed','Швидкість вильоту',0.05,5,0.005),range('sprayLifetime','Тривалість шлейфу',0.1,4,0.005),range('sprayLift','Викид угору',0,4,0.005),range('sprayGravity','Сила падіння',0,12,0.01),range('sprayMist','Снігова пудра',0,1,0.005),range('sprayTurbulence','Завихрення частинок',0,4,0.005),{type:'action',id:'jump',text:'✳ Разовий сніговий викид'}]},
    {title:'Положення колеса',items:[range('wheelScale','Масштаб',0.35,2.3,0.005),range('wheelYaw','Поворот до камери',-180,180,0.5,'°'),range('wheelTilt','Нахил колеса',-100,100,0.5,'°'),range('wheelPitch','Нахил у глибину',-90,90,0.5,'°'),range('wheelX','Зміщення вліво / вправо',-3,3,0.005),range('wheelZ','Зміщення вглиб',-3,3,0.005)]},
    {title:'Камера й паралакс',items:[toggle('parallaxEnabled','Паралакс від курсору'),range('parallaxAmount','Сила паралаксу',0,3,0.01,'°'),range('parallaxSmoothing','Швидкість реакції',0.1,30,0.05)]},
  ]},
  rubber:{title:'Матеріал шини',icon:'◉',label:'Шина',intro:'Гума та об’ємний зимовий протектор налаштовуються окремо від металевого диска.',sections:[
    {title:'Поверхня гуми',items:[color('rubberColor','Колір гуми'),range('rubberRoughness','Матовість',0,1,0.005),range('rubberMetalness','Металевий відблиск',0,1,0.005),range('rubberBump','Мікрорельєф гуми',0,0.25,0.0005)]},
    {title:'Зимовий протектор',items:[range('treadDepth','Висота блоків',0.005,0.2,0.0005),range('treadSnow','Сніг у канавках',0,1,0.005)]},
    {title:'Текстура шини',items:[{type:'upload',target:'rubber'},range('rubberTextureScale','Повторення текстури',0.05,30,0.005),range('rubberTextureRotation','Поворот текстури',-720,720,0.5,'°'),range('rubberTextureMix','Сила текстури',0,1,0.005)]},
  ]},
  rim:{title:'Матеріал диска',icon:'⊕',label:'Диск',intro:'Окрема система матеріалу: від шліфованого алюмінію до темного матового металу.',sections:[
    {title:'Метал і покриття',items:[select('rimFinish','Покриття',[['brushed','Шліфоване'],['polished','Поліроване'],['matte','Матове']]),color('rimColor','Колір диска'),range('rimMetalness','Металічність',0,1,0.005),range('rimRoughness','Матовість',0,1,0.005),range('rimBump','Мікрорельєф металу',0,0.2,0.0005),select('spokeStyle','Кількість пар спиць',Array.from({length:10},(_,i)=>[i+3,`${i+3} ${i+3===3||i+3===4?'пари':'пар'}`]))]},
    {title:'Текстура диска',items:[{type:'upload',target:'rim'},range('rimTextureScale','Повторення текстури',0.05,30,0.005),range('rimTextureRotation','Поворот текстури',-720,720,0.5,'°'),range('rimTextureMix','Сила текстури',0,1,0.005)]},
  ]},
  lens:{title:'Ефект об’єктива',icon:'◌',label:'Лінза',intro:'М’яке розмиття по краях кадру. Центр фокусу залишається чітким — розмісти його на колесі.',sections:[
    {title:'Викривлення тексту при розгоні',items:[
      range('spinTextWarp','Викривлення літер',0,140,0.1,'пкс'),
      range('spinTextWave','Частота хвилі',0.25,3,0.005),
      range('spinTextMotion','Зміщення і поворот блоків',0,2,0.005),
      range('spinTextBlur','Розмиття тексту',0,2,0.005),
      {type:'action',id:'preview-spin',text:'Переглянути ефект'},
    ]},
    {title:'Камера при розгоні',items:[
      toggle('spinEnabled','Ефект під час обертання'),
      range('spinZoom','Наближення камери',0,55,0.1,'%'),
      range('spinSceneTwist','Закручення країв сцени',-25,25,0.05,'°'),
      range('spinSceneBlur','Кругове розмиття сцени',0,2.5,0.005),
      range('spinRPMResponse','Обертів для 63% сили',20,400,0.1,'об/хв'),
      range('spinAttack','Час наростання',0.02,1.5,0.005,'с'),
      range('spinRelease','Час згасання',0.02,2.5,0.005,'с'),
    ]},
    {title:'Рамка розмиття',items:[toggle('lensEnabled','Увімкнути ефект лінзи'),range('lensBlur','Сила розмиття',0,24,0.05,'пкс'),range('lensRadius','Розмір чіткої зони',0.1,1.4,0.005),range('lensSoftness','М’якість переходу',0.01,1,0.005)]},
    {title:'Зона фокусу',items:[range('lensCenterX','Центр по горизонталі',0,1,0.005),range('lensCenterY','Центр по вертикалі',0,1,0.005),range('lensAspect','Ширина зони фокусу',0.3,3,0.005)]},
    {title:'Оптика по краях',items:[range('lensVignette','Затемнення країв',0,1,0.005),range('lensChromatic','Кольорова облямівка',0,3,0.005,'пкс')]},
  ]},
};

const allControls=Object.values(panels).flatMap(p=>p.sections.flatMap(s=>s.items));
function clampSettings(){for(const c of allControls){if(c.type==='range'){const value=Number(settings[c.key]);settings[c.key]=Math.min(c.max,Math.max(c.min,Number.isFinite(value)?value:(defaults[c.key]??c.min)));}}settings.spokeStyle=Math.min(12,Math.max(3,Math.round(Number(settings.spokeStyle)||5)));}
clampSettings();
function save(){
  if(projectEditing){
    Object.assign(pending,differences(settings,lastQueued));
    lastQueued={...settings};
    saveProjectDraft();
    clearTimeout(presetTimer);
    $('#preset-status').textContent='Записуємо в проєкт…';
    presetTimer=setTimeout(flushPreset,150);
    return;
  }
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(differences(settings,defaults)));}catch{}
}
function saveProjectDraft(){
  try{
    const draft={...inFlight,...pending};
    if(Object.keys(draft).length)localStorage.setItem(PROJECT_DRAFT_KEY,JSON.stringify(draft));
    else localStorage.removeItem(PROJECT_DRAFT_KEY);
  }catch{}
}
async function flushPreset(){
  if(saving||!Object.keys(pending).length)return;
  saving=true;
  $('#retry-preset').hidden=true;
  $('#preset-status').textContent='Записуємо в проєкт…';
  try{
    while(Object.keys(pending).length){
      const changes=pending;
      inFlight=changes;
      pending={};
      try{
        const response=await fetch(presetEndpoint,{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(changes),
        });
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        rememberProjectPreset(sanitizeSettings(await response.json()));
      }catch(error){
        pending={...changes,...pending};
        throw error;
      }finally{
        inFlight={};
        saveProjectDraft();
      }
    }
    $('#preset-status').textContent='Записано в основу сайту';
  }catch(error){
    console.warn('Scene preset write failed',error);
    $('#preset-status').textContent='Не вдалося записати в проєкт';
    $('#retry-preset').hidden=false;
  }finally{
    saving=false;
  }
}
$('#retry-preset').addEventListener('click',flushPreset);
if(!projectEditing)save();
else if(Object.keys(pending).length)void flushPreset();
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),3400);}
async function restoreProjectTextures(){
  try{
    const response=await fetch(new URL('manifest.json',textureDirectory),{cache:'no-store'});
    if(!response.ok)throw new Error();
    const manifest=await response.json();
    const jobs=textureTargets.flatMap(target=>textureSlots.flatMap(slot=>{
      const entry=manifest[target]?.[slot];
      if(!entry)return [];
      return [(async()=>{
        const texture=await scene.loadTexture(new URL(entry.file,textureDirectory).href);
        scene.applyTexture(target,slot,texture,entry.name);
      })()];
    }));
    const results=await Promise.allSettled(jobs);
    if(results.some(result=>result.status==='rejected'))throw new Error();
  }catch{toast('Не вдалося відновити всі текстури проєкту');}
}
async function editTextures(action){
  if(textureBusy){toast('Зачекай, поки завершиться операція з текстурами');return;}
  textureBusy=true;
  try{await action();}finally{textureBusy=false;}
}
async function removeProjectTextures(target){
  if(!projectEditing)return;
  const response=await fetch(target?`${textureEndpoint}/${target}`:textureEndpoint,{method:'DELETE'});
  if(!response.ok)throw new Error();
}
function display(n,step){const [coefficient,exponent='0']=String(step).split('e');const precision=Math.max(0,(coefficient.split('.')[1]?.length||0)-Number(exponent));return Number(Number(n).toFixed(Math.min(8,precision))).toString();}
function update(key,value){
  settings[key]=value;clampSettings();
  if(key==='rimFinish'){
    Object.assign(settings,{rimRoughness:value==='polished'?0.08:value==='matte'?0.68:0.23,rimBump:value==='polished'?0.001:0.004});
    renderPanel();
  }
  scene?.update(key);save();syncReadout();
}
function syncReadout(rpm=scene?.motorRPM??0){
  $('#rpm-readout').textContent=`${display(rpm,0.1)} об/хв`;
  const speed=String(Math.round(Math.abs(rpm))).padStart(3,'0');
  const gauge=$('#promo-rpm');
  if(gauge.textContent!==speed)gauge.textContent=speed;
}
function renderPanel(){
  const p=panels[activeTab];
  $('#panel-tabs').innerHTML=Object.entries(panels).map(([id,p])=>`<button role="tab" aria-selected="${id===activeTab}" data-tab="${id}"><span class="tab-icon" aria-hidden="true">${p.icon}</span>${p.label}</button>`).join('');
  const content=$('#panel-content');
  content.innerHTML=`<div class="tab-intro"><h1>${p.title}</h1><p>${p.intro}</p></div>`+p.sections.map(s=>`<details class="section" ${s.closed?'':'open'}><summary>${s.title}</summary><div>${s.items.map(renderControl).join('')}</div></details>`).join('');
  content.querySelectorAll('input[type=range]').forEach(input=>{
    const c=allControls.find(c=>c.key===input.dataset.key);input.style.setProperty('--fill',`${(settings[c.key]-c.min)/(c.max-c.min)*100}%`);
    input.addEventListener('input',()=>{const value=Number(input.value);const field=content.querySelector(`[data-number="${c.key}"]`);field.value=display(value,c.step);input.style.setProperty('--fill',`${(value-c.min)/(c.max-c.min)*100}%`);update(c.key,value);});
  });
  content.querySelectorAll('[data-number]').forEach(input=>{
    input.addEventListener('input',()=>{const c=allControls.find(c=>c.key===input.dataset.number);if(input.value.trim()==='')return;const v=Number(input.value);if(!Number.isFinite(v))return;update(c.key,Math.max(c.min,Math.min(c.max,v)));const slider=content.querySelector(`#${c.key}`);slider.value=settings[c.key];slider.style.setProperty('--fill',`${(settings[c.key]-c.min)/(c.max-c.min)*100}%`);});
    input.addEventListener('change',()=>{const c=allControls.find(c=>c.key===input.dataset.number);input.value=display(settings[c.key],c.step);});
  });
  content.querySelectorAll('[data-nudge-key]').forEach(button=>button.addEventListener('click',()=>{
    const c=allControls.find(c=>c.key===button.dataset.nudgeKey);
    update(c.key,Number(display(settings[c.key]+Number(button.dataset.direction)*c.step,c.step)));
    const slider=content.querySelector(`#${c.key}`);
    slider.value=settings[c.key];
    slider.style.setProperty('--fill',`${(settings[c.key]-c.min)/(c.max-c.min)*100}%`);
    content.querySelector(`[data-number="${c.key}"]`).value=display(settings[c.key],c.step);
  }));
  content.querySelectorAll('input[type=color]').forEach(input=>input.addEventListener('input',()=>{input.nextElementSibling.textContent=input.value.toUpperCase();update(input.dataset.key,input.value);}));
  content.querySelectorAll('input[type=checkbox]').forEach(input=>input.addEventListener('change',()=>update(input.dataset.key,input.checked)));
  content.querySelectorAll('select').forEach(input=>input.addEventListener('change',()=>update(input.dataset.key,input.dataset.key==='spokeStyle'?Number(input.value):input.value)));
  content.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>applyPreset(button.dataset.preset)));
  content.querySelectorAll('[data-action=jump]').forEach(button=>button.addEventListener('click',()=>scene.jump()));
  content.querySelectorAll('[data-action=preview-spin]').forEach(button=>button.addEventListener('click',()=>{
    if(scene.paused)$('#pause').click();
    scene.drive.kick(700);
    if(!hidden)toggleUI();
  }));
  content.querySelectorAll('[data-action=stop-wheel]').forEach(button=>button.addEventListener('click',()=>{scene.stopWheel();syncReadout();}));
  content.querySelectorAll('[data-action=clear-snow]').forEach(button=>button.addEventListener('click',()=>{scene.clearAccumulatedSnow();toast('Накопичений сніг очищено');}));
  content.querySelectorAll('[data-upload]').forEach(input=>input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file)return;
    if(!file.type.startsWith('image/')){toast('Оберіть зображення PNG, JPG або WebP.');return;}
    if(file.size>20*1024*1024){toast('Оберіть зображення до 20 МБ.');return;}
    await editTextures(async()=>{
      const target=input.dataset.upload,slot=input.dataset.slot;
      let texture;
      try{texture=await scene.loadTextureFile(file);}
      catch{toast('Не вдалося прочитати це зображення');return;}
      if(projectEditing){
        toast('Записуємо текстуру в проєкт…');
        try{
          const response=await fetch(`${textureEndpoint}/${target}/${slot}`,{
            method:'PUT',headers:{'Content-Type':file.type,'X-Texture-Name':encodeURIComponent(file.name)},body:file,
          });
          if(!response.ok)throw new Error();
        }catch{
          texture.dispose();
          input.value='';
          toast('Не вдалося записати текстуру в проєкт');
          return;
        }
      }
      scene.applyTexture(target,slot,texture,file.name);
      renderPanel();
      toast(projectEditing?'Текстуру записано в основу сайту':'Текстуру застосовано до поточного сеансу');
    });
  }));
  content.querySelectorAll('[data-clear-texture]').forEach(button=>button.addEventListener('click',()=>editTextures(async()=>{
    const target=button.dataset.clearTexture;
    try{await removeProjectTextures(target);}
    catch{toast('Не вдалося видалити текстури з проєкту');return;}
    scene.clearTextures(target);
    renderPanel();
    toast('Відновлено процедурний матеріал');
  })));
  $('#panel-tabs').querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{activeTab=button.dataset.tab;renderPanel();$('#panel-content').scrollTop=0;}));
}
function renderControl(c){
  const v=settings[c.key];
  if(c.type==='range')return `<div class="slider-row"><div class="slider-label"><label for="${c.key}">${c.label}</label><span class="value-field"><input type="number" aria-label="${c.label}: значення" data-number="${c.key}" value="${display(v,c.step)}" min="${c.min}" max="${c.max}" step="${c.step}">${c.unit?`<span class="unit">${c.unit}</span>`:''}</span></div><input type="range" id="${c.key}" data-key="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"><div class="range-limits"><span>Мін. ${display(c.min,c.step)}</span><span class="range-nudges"><button type="button" data-nudge-key="${c.key}" data-direction="-1" aria-label="${c.label}: зменшити на ${c.step}" title="Зменшити на ${c.step}">−</button><button type="button" data-nudge-key="${c.key}" data-direction="1" aria-label="${c.label}: збільшити на ${c.step}" title="Збільшити на ${c.step}">+</button></span><span>Макс. ${display(c.max,c.step)}</span></div></div>`;
  if(c.type==='color')return `<div class="color-row"><label for="${c.key}">${c.label}</label><span class="color-field"><input type="color" id="${c.key}" data-key="${c.key}" value="${v}"><span>${v.toUpperCase()}</span></span></div>`;
  if(c.type==='toggle')return `<div class="toggle-row"><label for="${c.key}">${c.label}</label><input type="checkbox" id="${c.key}" data-key="${c.key}" ${v?'checked':''}></div>`;
  if(c.type==='select')return `<div class="select-row"><label for="${c.key}">${c.label}</label><select id="${c.key}" data-key="${c.key}">${c.options.map(([val,label])=>`<option value="${val}" ${String(val)===String(v)?'selected':''}>${label}</option>`).join('')}</select></div>`;
  if(c.type==='action')return `<button class="action-button ${c.primary?'primary':''}" data-action="${c.id}">${c.text}</button>`;
  if(c.type==='presets')return `<div class="presets">${c.presets.map(([id,title])=>`<button class="preset" data-preset="${id}">${title}</button>`).join('')}</div>`;
  if(c.type==='upload')return ['map','bumpMap','roughnessMap'].map((slot,i)=>`<label class="texture-upload">${['+ Колірна текстура','+ Карта рельєфу','+ Карта матовості'][i]}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" data-upload="${c.target}" data-slot="${slot}" aria-label="${['Колірна текстура','Карта рельєфу','Карта матовості'][i]}"></label>${scene?.textureNames[c.target]?.[slot]?`<p class="upload-status">✓ ${escapeHTML(scene.textureNames[c.target][slot])}</p>`:''}`).join('')+`<button class="text-button" data-clear-texture="${c.target}">↺ Відновити процедурну текстуру</button>`;
  return '';
}
function escapeHTML(s){const t=document.createElement('span');t.textContent=s;return t.innerHTML;}
function applyPreset(id){
  const presets={
    overcast:{sunIntensity:2.5,sunAzimuth:-72,sunElevation:24,sunColor:'#e9efff',ambientIntensity:.55,fillIntensity:.8,rimIntensity:2.2,exposure:.9,skyColor:'#8796ab',horizonColor:'#b6c1d1',ambientColor:'#c5d3e8'},
    morning:{sunIntensity:5.1,sunAzimuth:-62,sunElevation:14,sunColor:'#ffe2bf',ambientIntensity:1,fillIntensity:1.4,rimIntensity:3.5,exposure:1.1,skyColor:'#b1becf',horizonColor:'#e1d3c7',ambientColor:'#b9d0f0'},
    blue:{sunIntensity:1.1,sunAzimuth:42,sunElevation:18,sunColor:'#b4d3ff',ambientIntensity:0.8,fillIntensity:2.2,rimIntensity:5.5,exposure:0.85,skyColor:'#364963',horizonColor:'#718aa8',ambientColor:'#7b9ed8'},
    studio:{sunIntensity:5.5,sunAzimuth:-80,sunElevation:35,sunColor:'#ffffff',ambientIntensity:0.65,fillIntensity:2.5,rimIntensity:5,exposure:1.05,skyColor:'#8e9bac',horizonColor:'#c1ccdb',ambientColor:'#b3c8e5'},
  };
  Object.assign(settings,presets[id]);scene.update();save();renderPanel();toast('Схему освітлення застосовано');
}
function toggleUI(){if(scene&&scene.stage!=='storm')return;hidden=!hidden;$('#app').classList.toggle('ui-hidden',hidden);$('#show-ui').hidden=!hidden;scene?.setPanelVisible(!hidden);}
$('#hide-ui').addEventListener('click',toggleUI);$('#show-ui').addEventListener('click',toggleUI);
$('#reset-all').addEventListener('click',()=>editTextures(async()=>{
  try{await removeProjectTextures();}
  catch{toast('Не вдалося скинути текстури проєкту');return;}
  Object.assign(settings,projectEditing?factoryDefaults:defaults);
  scene.reset();
  if(!projectEditing)await restoreProjectTextures();
  save();renderPanel();syncReadout();toast('Початкові налаштування відновлено');
}));
$('#pause').addEventListener('click',()=>{scene.paused=!scene.paused;$('#pause-icon').textContent=scene.paused?'▷':'Ⅱ';$('#pause').setAttribute('aria-label',scene.paused?'Відновити анімацію':'Зупинити анімацію');});
$('#reset-camera').addEventListener('click',()=>scene.resetCamera());
$('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Повноекранний режим недоступний у цьому перегляді.');}});
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(e.key.toLowerCase()==='h'||e.key.toLowerCase()==='р')toggleUI();if(e.code==='Space'&&document.activeElement.tagName!=='BUTTON'){e.preventDefault();$('#pause').click();}});
$('#export-settings').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({version:8,settings},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='winter-wheel-settings.json';a.click();URL.revokeObjectURL(url);toast('Параметри експортовано в JSON.');});
$('#import-settings').addEventListener('click',()=>$('#settings-file').click());
$('#settings-file').addEventListener('change',async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(!data.settings)throw new Error();Object.assign(settings,defaults,sanitizeSettings(data.settings));if((data.version??1)<6)settings.rpm=defaults.rpm;clampSettings();scene.update();save();renderPanel();syncReadout();toast('Налаштування імпортовано');}catch{toast('Файл не містить коректних налаштувань студії.');}e.target.value='';});

try{
  const catalogUI=mountCatalog({
    onMove:direction=>scene?.catalog.move(direction),
    onPause:paused=>scene?.catalog.setPaused(paused),
    onBack:()=>scene?.returnFromCatalog(),
    onPreview:(canvas,index)=>scene?.drawCatalogPreview(canvas,index),
  });
  scene=new WinterScene($('#scene'),settings,(state,rpm)=>{$('#motion-state').textContent=state;syncReadout(rpm);},catalogProducts,catalogUI);
  await scene.ready;
  await restoreProjectTextures();
  $('#app').classList.add('ui-hidden');$('#show-ui').hidden=false;scene.setPanelVisible(false);
  renderPanel();syncReadout();
  requestAnimationFrame(()=>{ $('#loading').classList.add('loaded');setTimeout(()=>$('#loading').remove(),800); });
}catch(error){console.error('Scene initialization failed',error);$('#error').hidden=false;$('#loading').hidden=true;}
