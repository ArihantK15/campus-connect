import api from './api.js';

const events=[];
const CAMPUS_TIME_ZONE='Asia/Kolkata';
function eventFromApi(record) {
 if(!record||typeof record.id!=='string'||typeof record.title!=='string'||!record.title.trim())throw new Error('Supabase returned an invalid event.');
 const parsed=typeof record.timestamp==='string'?new Date(record.timestamp):null;
 const validDate=parsed&&!Number.isNaN(parsed.getTime())?parsed:null;
 const parts=validDate?Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(validDate).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])):null;
 const day=parts?Number(parts.day):null;
 const month=parts?Number(parts.month):null;
 const year=parts?Number(parts.year):null;
 const dateKey=parts?`${parts.year}-${parts.month}-${parts.day}`:null;
 const imageNumber=Array.from(record.id).reduce((sum,char)=>sum+char.charCodeAt(0),0)%8+1;
 const title=record.title.trim();
 const category=/product|design|open source|acid|career|tech|build/i.test(title)?'Tech & Career':'General';
 return {
  id:record.id,title,subtitle:'Event details from the organizer will appear here.',
  category,day,month,year,dateKey,
  dateLabel:validDate?new Intl.DateTimeFormat('en-US',{timeZone:CAMPUS_TIME_ZONE,month:'short',day:'numeric',year:'numeric'}).format(validDate):'Date to be announced',
  monthLabel:validDate?new Intl.DateTimeFormat('en-US',{timeZone:CAMPUS_TIME_ZONE,month:'long',year:'numeric'}).format(validDate):'Date to be announced',
  time:validDate?new Intl.DateTimeFormat('en-US',{timeZone:CAMPUS_TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(validDate):'Time to be announced',
  location:'Location to be announced',image:`assets/event-${imageNumber}.jpg`,
  going:null,capacity:Number.isInteger(record.capacity)&&record.capacity>=0?record.capacity:null,
  price:null,host:'Campus organizer',description:'The organizer has not added a description yet.',
  timestamp:validDate?validDate.toISOString():null
 };
}

// This prototype uses browser-local accounts. There is no server authentication.
const $ = selector => document.querySelector(selector);
$('.hero').hidden=true;
$('.attendee-stack').hidden=true;
$('.semester').textContent='Campus events';
$('[data-category="All events"] span').textContent='0';
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
 spark:'<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
 campus:'<path d="m3 8 9-5 9 5H3ZM5 10v8M10 10v8M14 10v8M19 10v8M3 21h18"/>',
 chevron:'<path d="m7 10 5 5 5-5"/>',
 discover:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
 bookmark:'<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z"/>',
 people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
 search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
 filter:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
 arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>'
};
const icon = (name, filled=false) => `<svg class="icon" viewBox="0 0 24 24" fill="${filled?'currentColor':'none'}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.discover}</svg>`;
const memory = new Map(); let storageWarning = false;
function read(key, fallback) { try { const raw = localStorage.getItem('cc-'+key); return raw === null ? (memory.get(key) ?? fallback) : JSON.parse(raw); } catch { return memory.get(key) ?? fallback; } }
function write(key, value) { memory.set(key,value); try { localStorage.setItem('cc-'+key,JSON.stringify(value)); } catch { if (!storageWarning) { storageWarning=true; setTimeout(()=>toast('Browser storage is unavailable. Changes will last only for this session.'),0); } } }
const validIds = value => Array.isArray(value) ? [...new Set(value.filter(id=>events.some(event=>event.id===id)))] : [];
let accounts = read('accounts',[]); if (!Array.isArray(accounts)) accounts=[];
accounts = accounts.filter(a=>a && typeof a.email==='string' && typeof a.name==='string' && a.name.trim() && typeof a.salt==='string' && typeof a.hash==='string');
let profiles = read('profiles',{}); if (!profiles || typeof profiles!=='object' || Array.isArray(profiles)) profiles={};
let activeEmail = read('session',null);
let user = accounts.find(a=>a.email===activeEmail) || null;
api.setUser(user?.email||null);
let saved=[], registered=[], joined=[], category='All events', page='discover', calendar=false, eventsLoadFailed=false;
let pending=null, lastFocus=null;
let legacyUser=read('user',null);
function getProfile(key) {const p=profiles[key]||{};return {saved:validIds(p.saved),registered:validIds(p.registered),groups:Array.isArray(p.groups)?p.groups.filter(i=>Number.isInteger(i)&&i>=0&&i<4):[]};}
function restoreProfile() { const p=getProfile(user?user.email:'guest');saved=p.saved;registered=user?p.registered:[];joined=user?p.groups:[]; }
function persist() {const key=user?user.email:'guest';profiles[key]={saved,registered:user?registered:[],groups:user?joined:[]};write('profiles',profiles);write('session',user?.email||null);}
// Preserve previous prototype data only when its owner signs up with the same email.
if (!profiles.guest) {profiles.guest={saved:validIds(read('saved',[])),registered:[],groups:[]};write('profiles',profiles);}
restoreProfile();
function profile() {
 $('#event-count').textContent=registered.length;
 $('#profile-name').textContent=user?user.name.split(/\s+/)[0]:'Sign up / Log in';
 $('#profile-btn').setAttribute('aria-label',user?`Your profile: ${user.name}`:'Sign up or log in');
 if(user)$('#avatar').textContent=user.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();else $('#avatar').innerHTML=icon('arrow');
}
function toast(message) {$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
async function loadEvents() {
 try {
  const rows=await api.getEvents();
  if(!Array.isArray(rows))throw new Error('The events API returned an invalid response.');
  const loaded=rows.map(eventFromApi);
  events.splice(0,events.length,...loaded);
  eventsLoadFailed=false;
  saved=validIds(saved);registered=validIds(registered);
  if(user)await loadUserRegistrations();
  render();
 } catch(error) {
  events.splice(0,events.length);
  eventsLoadFailed=true;
  render();
  console.error('Failed to load events:',error);
  toast(error.message||'Events could not be loaded. Check the backend connection and try again.');
 }
}
async function loadUserRegistrations() {
 if(!user)return false;
 api.setUser(user.email);
 try {
  const rows=await api.getMyRegistrations();
  if(!Array.isArray(rows))throw new Error('The registrations API returned an invalid response.');
  registered=[...new Set(rows.map(row=>row.event_id).filter(id=>events.some(event=>event.id===id)))];
  persist();render();
  return true;
 } catch(error) {
  console.error('Failed to load registrations:',error);
  if(error.status===404) {
   user=null;api.setUser(null);write('session',null);restoreProfile();render();
   toast('This local account is not a seeded demo user. Please sign in with a seeded attendee email.');
   return false;
  }
  toast(error.message||'Your registrations could not be loaded.');
  return false;
 }
}
function updateHero() {
 const feature=events.find(event=>event.timestamp)||events[0];
 $('.hero').hidden=page!=='discover'||!feature;
 if(!feature)return;
 $('.attendee-stack').hidden=true;
 $('.hero>img').src=feature.image;
 $('.hero>img').alt='';
 $('.hero-content h2').textContent=feature.title;
 $('.hero-content>p').textContent=feature.subtitle;
 const meta=$$('.hero-meta');
 if(meta)meta.innerHTML=[['calendar',feature.dateLabel],['clock',feature.time],['pin',feature.location]].map(([name,value])=>`<span>${icon(name)} ${esc(value)}</span>`).join('');
 const going=$('.hero-bottom>span');
 if(going)going.textContent=feature.capacity===null?'Capacity not listed':`${feature.capacity} total spots`;
 $('#hero-details').disabled=false;
}
function $$(selector) {return document.querySelector(selector);}
function scopeEvents() {return events.filter(e=>page!=='saved'||saved.includes(e.id)).filter(e=>page!=='registered'||registered.includes(e.id));}
function hasFilters() {return category!=='All events'||$('#search').value.trim()!==''||$('#free-filter').checked||$('#date-filter').value!=='all';}
function clearFilters() {category='All events';$('#search').value='';$('#free-filter').checked=false;$('#date-filter').value='all';render();}
function isWithinNextSevenDays(event) {
 if(!event.dateKey)return false;
 const [year,month,day]=event.dateKey.split('-').map(Number);
 const [todayYear,todayMonth,todayDay]=new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).split('-').map(Number);
 const eventDay=Date.UTC(year,month-1,day),today=Date.UTC(todayYear,todayMonth-1,todayDay);
 return eventDay>=today&&eventDay<today+7*86400000;
}
function filteredEvents() {const query=$('#search').value.trim().toLocaleLowerCase();return scopeEvents().filter(e=>(category==='All events'||e.category===category)&&(!query||`${e.title} ${e.subtitle} ${e.category} ${e.location} ${e.host} ${e.description}`.toLocaleLowerCase().includes(query))&&(!$('#free-filter').checked||e.price===0)&&($('#date-filter').value!=='week'||isWithinNextSevenDays(e)));}
function render() {
 profile();updateHero();const community=page==='communities';
 $('#calendar-btn').hidden=community;$('#filter-panel').hidden=community||$('#filter-btn').getAttribute('aria-expanded')!=='true';
 $('#calendar-heading').hidden=community||!calendar;$('.result-summary').hidden=community;
 const freeFilter=$('#free-filter'),hasKnownPrices=events.some(event=>event.price!==null);
 freeFilter.disabled=!hasKnownPrices;
 freeFilter.title=hasKnownPrices?'':'Price information is not available for these events.';
 freeFilter.setAttribute('aria-description',hasKnownPrices?'Filters events with known zero-price tickets.':'Price information is not available for these events.');
 if(!hasKnownPrices)freeFilter.checked=false;
 document.querySelectorAll('[data-category]').forEach(button=>{const selected=button.dataset.category===category;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
 $('[data-category="All events"] span').textContent=scopeEvents().length;
 $('#clear-filters').hidden=!hasFilters();$('#filter-btn').classList.toggle('has-filters',$('#free-filter').checked||$('#date-filter').value!=='all');
 $('#calendar-btn').innerHTML=icon(calendar?'discover':'calendar')+(calendar?'Card view':'Calendar view');
 $('#calendar-btn').setAttribute('aria-pressed',String(calendar));
 if(community){$('#empty-state').hidden=true;renderCommunities();return;}
 const list=filteredEvents(),calendarMonths=[...new Set(list.filter(event=>event.dateKey).map(event=>event.monthLabel))];
 const calendarSummary=calendar?(calendarMonths.length===1?` in ${calendarMonths[0]}`:calendarMonths.length>1?` across ${calendarMonths.length} months`:''):'';
 $('#results-count').textContent=`${list.length} ${list.length===1?'event':'events'}${hasFilters()?' match your filters':''}${calendarSummary}`;
 if(calendar&&list.length)$('#calendar-heading h3').textContent=calendarMonths.length===1?calendarMonths[0]:'Event calendar';
 $('#empty-state').hidden=list.length>0;
 const title=$('#empty-state h3');
 if(hasFilters()) {title.textContent='No events match those filters.';$('#empty-text').textContent='Try another search or clear your filters to see more events.';$('#empty-action').textContent='Clear filters';}
 else if(eventsLoadFailed){title.textContent='Events could not be loaded.';$('#empty-text').textContent='Check that the Flask backend is running and Supabase is configured.';$('#empty-action').textContent='Try again';}
 else if(page==='registered') {title.textContent=user?'Your next plan starts here.':'Your plans belong here.';$('#empty-text').textContent=user?'Register for an event and your entry pass will appear here.':'Log in to see your registrations, or discover an event to get started.';$('#empty-action').textContent=user?'Discover events':'Log in / Sign up';}
 else if(page==='saved'){title.textContent='Save a little something for later.';$('#empty-text').textContent='Tap the bookmark on any event. Your saved events will appear here.';$('#empty-action').textContent='Discover events';}
 else {title.textContent='More moments are on their way.';$('#empty-text').textContent='Check back soon for new campus events.';$('#empty-action').textContent='Explore communities';}
 if(!list.length){$('#events-grid').innerHTML='';$('#events-grid').className='events-grid';$('#calendar-heading').hidden=true;return;}
 if(calendar) {renderCalendar(list);return;}
 $('#events-grid').className='events-grid';$('#events-grid').innerHTML=list.map(card).join('');
}
function card(e) {
 const isSaved=saved.includes(e.id),isRegistered=registered.includes(e.id);
 const style=e.category==='Social'?'social':e.category==='Music & Arts'?'music':e.category==='Sports & Wellness'?'sports':'tech';
 const availability=e.capacity===null?'Capacity not listed':`${e.capacity} spots total`;
 const price=e.price===null?'Price not listed':e.price?'$'+e.price+' · pay at event':'Free entry';
 return `<article class="event-card" data-card="${esc(e.id)}"><div class="card-image"><img src="${esc(e.image)}" alt="" loading="lazy"><div class="date-badge" aria-label="${esc(e.dateLabel)}"><small>${esc(e.monthLabel?.split(' ')[0]||'TBA')}</small><b>${e.day===null?'--':String(e.day).padStart(2,'0')}</b></div><button class="save-button ${isSaved?'saved':''}" data-save="${esc(e.id)}" aria-label="${isSaved?'Unsave':'Save'} ${esc(e.title)}" aria-pressed="${isSaved}">${icon('bookmark',isSaved)}</button></div><div class="card-content"><span class="category-label category-${style}">${esc(e.category)}</span><h3><button data-detail="${esc(e.id)}">${esc(e.title)}</button></h3><p class="event-subtitle">${esc(e.subtitle)}</p><div class="card-meta">${icon('calendar')}<span>${esc(e.dateLabel)}</span></div><div class="card-meta">${icon('clock')}<span>${esc(e.time)}</span></div><div class="card-meta">${icon('pin')}<span>${esc(e.location)}</span></div><div class="card-footer"><span>${icon('people')} ${esc(availability)}</span><span class="price ${e.price?'paid':''}">${isRegistered?'Registered ✓':esc(price)}</span></div><button class="card-action" data-${isRegistered?'ticket':'detail'}="${esc(e.id)}">${isRegistered?'View entry pass':'View event'} ${icon('arrow')}</button></div></article>`;
}
function renderCalendar(list) {
 const dated=list.filter(event=>event.dateKey).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const undated=list.filter(event=>!event.dateKey);
 const months=new Map();
 dated.forEach(event=>{
  const key=event.dateKey.slice(0,7);
  if(!months.has(key))months.set(key,[]);
  months.get(key).push(event);
 });
 const monthHtml=[...months.values()].map(monthEvents=>{
  const first=monthEvents[0],monthIndex=first.month-1,year=first.year;
  const firstWeekday=new Date(Date.UTC(year,monthIndex,1)).getUTCDay();
  const dayCount=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate();
  const cellCount=Math.ceil((firstWeekday+dayCount)/7)*7;
  const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<div class="calendar-weekday">${day}</div>`).join('');
  const days=Array.from({length:cellCount},(_,i)=>{
   const day=i-firstWeekday+1,isInMonth=day>0&&day<=dayCount;
   const number=isInMonth?`<span class="calendar-number" aria-label="${esc(first.monthLabel)} ${day}">${day}</span>`:'';
   const dayEvents=monthEvents.filter(event=>event.day===day).map(event=>`<button data-detail="${esc(event.id)}"><strong>${esc(event.title)}</strong><span>${esc(event.time)}</span></button>`).join('');
   return `<div class="calendar-day ${isInMonth?'':'outside-month'}">${number}${dayEvents}</div>`;
  }).join('');
  const agenda=monthEvents.map(event=>`<button data-detail="${esc(event.id)}"><b>${esc(event.dateLabel)}</b><span>${esc(event.title)}<small>${esc(event.time)}</small></span>${icon('arrow')}</button>`).join('');
  return `<section class="calendar-month"><h4>${esc(first.monthLabel)}</h4><div class="calendar-grid">${weekdays}${days}<div class="calendar-agenda">${agenda}</div></div></section>`;
 }).join('');
 const undatedHtml=undated.length?`<section class="calendar-undated"><h4>Date to be announced</h4><div class="calendar-undated-list">${undated.map(event=>`<button data-detail="${esc(event.id)}"><b>${esc(event.title)}</b><span>${esc(event.time)}</span>${icon('arrow')}</button>`).join('')}</div></section>`:'';
 $('#events-grid').className='events-grid calendar-months';
 $('#events-grid').innerHTML=monthHtml+undatedHtml;
}
function openModal(html) {
 if($('#modal').hidden)lastFocus=document.activeElement;
 $('#modal-content').innerHTML=html;
 const heading=$('#modal-content h2');if(heading)heading.id='dialog-title';
 $('#modal').hidden=false;document.body.style.overflow='hidden';
 $('.sidebar').inert=true;$('.app').inert=true;$('.skip-link').inert=true;
 normalizeIcons($('#modal-content'));$('.modal').scrollTop=0;$('.modal').focus();
}
function closeModal() {
 $('#modal').hidden=true;document.body.style.overflow='';$('.sidebar').inert=false;$('.app').inert=false;$('.skip-link').inert=false;pending=null;
 if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});else $('#section-title').parentElement.closest('section').focus({preventScroll:true});
}
function detail(id) {
 const e=events.find(e=>e.id===id);if(!e)return;
 const ticket=e.price===null?'Ticket pricing not listed':e.price?'$'+e.price+' · pay at the event':'Free · Everyone welcome';
 const capacity=e.capacity===null?'Capacity not listed':`${e.capacity} total spots`;
 openModal(`<img class="modal-image" src="${esc(e.image)}" alt=""><div class="modal-body"><span class="category-label">${esc(e.category)}</span><h2>${esc(e.title)}</h2><p>${esc(e.subtitle)}</p><div class="detail-info"><div><span>WHEN</span>${esc(e.dateLabel)}<br>${esc(e.time)}</div><div><span>WHERE</span>${esc(e.location)}</div><div><span>HOSTED BY</span>${esc(e.host)}</div><div><span>YOUR TICKET</span>${esc(ticket)}</div><div><span>CAPACITY</span>${esc(capacity)}</div></div><h3>A little more about it</h3><p>${esc(e.description)}</p><button class="primary-btn" id="register-btn">${registered.includes(id)?'View your entry pass':'Register interest'} ${icon('arrow')}</button></div>`);
 $('#register-btn').onclick=()=>{if(registered.includes(id)){success(e);return;}pending={type:'event',id};if(!user){auth();return;}confirmRegistration(e);};
}
async function passwordHash(password,salt) {
 if(!globalThis.crypto?.subtle)throw new Error('Password verification needs a local server. Start the site with the included launcher.');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return Array.from(new Uint8Array(bits)).map(n=>n.toString(16).padStart(2,'0')).join('');
}
function auth(login=false,draft={}) {
 openModal(`<div class="modal-body"><span class="auth-logo" aria-hidden="true">✳</span><div class="eyebrow">YOUR CAMPUS STORY STARTS HERE</div><h2>${login?'Welcome back.':'A campus full of possibilities.'}</h2><p>${pending?.type==='event'?'Sign in to finish your event registration.':pending?.type==='community'?'Sign in to join this community.':'Meet your people. Make your plans. Feel a little more connected.'}</p><form id="auth-form">${login?'':`<label class="form-field">Your name<input name="name" autocomplete="name" placeholder="Jamie Davis" value="${esc(draft.name||'')}" required minlength="2" maxlength="60"></label>`}<label class="form-field">Email address<input name="email" type="email" placeholder="you@westbridge.edu" autocomplete="email" value="${esc(draft.email||'')}" required maxlength="254" spellcheck="false" autocapitalize="none"></label><label class="form-field" for="auth-password">Password <span class="field-hint">At least 8 characters</span></label><div class="password-field"><input id="auth-password" name="password" type="password" autocomplete="${login?'current-password':'new-password'}" required minlength="8" maxlength="128"><button type="button" id="show-password" aria-label="Show password" aria-pressed="false">Show</button></div><p id="auth-error" class="form-error" role="alert" hidden></p><button class="primary-btn auth-submit" type="submit">${login?'Log in':'Create local demo account'} ${icon('arrow')}</button></form><div class="form-switch">${login?'New around here?':'Already part of the community?'} <button id="auth-switch">${login?'Sign up':'Log in'}</button></div><p class="auth-note"><b>Local prototype:</b> use a sample password. Accounts work only in this browser and are not university accounts. Passwords are stored as salted hashes. No email is sent.</p>${login?'<p class="legacy-note">Used the previous version? Create a local account with the same email to recover your saved events and registrations.</p>':''}</div>`);
 $('#show-password').onclick=()=>{const input=$('#auth-password'),show=input.type==='password';input.type=show?'text':'password';$('#show-password').textContent=show?'Hide':'Show';$('#show-password').setAttribute('aria-label',show?'Hide password':'Show password');$('#show-password').setAttribute('aria-pressed',String(show));};
 $('#auth-switch').onclick=()=>{const data=new FormData($('#auth-form'));auth(!login,{name:String(data.get('name')||draft.name||''),email:String(data.get('email')||'')});};
 $('#auth-form').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type="submit"]');if(submit.disabled)return;
  const data=new FormData(form),email=String(data.get('email')).trim().toLowerCase(),name=String(data.get('name')||'').trim().replace(/\s+/g,' '),password=String(data.get('password'));
  const showError=message=>{$('#auth-error').textContent=message;$('#auth-error').hidden=false;};
  if(!login&&name.length<2){showError('Please enter a name with at least 2 non-space characters.');return;}
  const existing=accounts.find(a=>a.email===email);
  if(!login&&existing){showError('An account with this email already exists in this browser. Choose Log in.');return;}
  if(login&&!existing){showError('No local account found for this email. Choose Sign up to create one.');return;}
  submit.disabled=true;submit.textContent=login?'Logging in…':'Creating your account…';$('#auth-error').hidden=true;
  try {
   let account;
   if(login){const hash=await passwordHash(password,existing.salt);if(hash!==existing.hash){showError('The email and password do not match. Please try again.');return;}account=existing;}
   else {const salt=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(n=>n.toString(16).padStart(2,'0')).join('');account={email,name,salt,hash:await passwordHash(password,salt)};}
   const serverRegistrations=await api.getMyRegistrations(email);
   if(!Array.isArray(serverRegistrations))throw new Error('The registrations API returned an invalid response.');
   // Ignore an asynchronous result if the visitor closed or changed the form.
   if(!form.isConnected||$('#modal').hidden)return;
   if(!login){accounts.push(account);write('accounts',accounts);if(legacyUser?.email?.toLowerCase()===email&&!profiles[email]){profiles[email]={saved:validIds(read('saved',[])),registered:validIds(read('registered',[])),groups:read('groups',[])};}}
   const guestSaved=[...saved];user=account;api.setUser(email);restoreProfile();registered=[...new Set(serverRegistrations.map(row=>row.event_id).filter(id=>events.some(event=>event.id===id)))];saved=[...new Set([...saved,...guestSaved])];persist();profile();render();
   if(pending?.type==='event'){confirmRegistration(events.find(e=>e.id===pending.id));}
   else if(pending?.type==='community'){const id=pending.id;pending=null;if(!joined.includes(id))joined.push(id);persist();render();closeModal();toast('You’re part of the community!');}
   else {closeModal();toast(`Welcome${login?' back':''}, ${user.name.split(' ')[0]}!`);}
  } catch(error) {if(form.isConnected)showError(error.status===404?'That email is not one of the seeded demo users. Use an attendee email from the project seed data.':error.message||'Something went wrong. Please try again.');}
  finally {if(form.isConnected){submit.disabled=false;submit.innerHTML=(login?'Log in':'Create local demo account')+' '+icon('arrow');}}
 };
}
function confirmRegistration(e) {
 if(!e||!user)return;
 openModal(`<div class="modal-body"><span class="category-label">YOU'RE ONE STEP AWAY</span><h2>Make it a plan.</h2><p>Reserve your spot for <strong>${esc(e.title)}</strong>.</p><div class="ticket"><strong>${esc(e.title)}</strong><small>${esc(e.dateLabel)} · ${esc(e.time)}<br>${esc(e.location)}</small></div><p>Registering as <b>${esc(user.name)}</b><br>${esc(user.email)}</p><p>No payment is collected by this demo.</p><p id="registration-error" class="form-error" role="alert" hidden></p><button class="primary-btn" id="confirm-btn">Confirm registration ${icon('arrow')}</button><button class="secondary-btn" id="back-detail">Back to event details</button></div>`);
 $('#back-detail').onclick=()=>detail(e.id);
 $('#confirm-btn').onclick=async()=>{
  const button=$('#confirm-btn');if(button.disabled)return;
  button.disabled=true;button.textContent='Saving your spot…';
  try {
   await api.registerForEvent(e.id,user.email);
   if(!registered.includes(e.id))registered.push(e.id);
   pending=null;persist();render();success(e);
  } catch(error) {
   if(error.status===409)await loadUserRegistrations();
   const message=$('#registration-error');if(message){message.textContent=error.message||'Registration failed. Please try again.';message.hidden=false;}
   button.disabled=false;button.innerHTML=`Confirm registration ${icon('arrow')}`;
  }
 };
}
function success(e) {
 if(!user||!registered.includes(e.id)){detail(e.id);return;}
 openModal(`<div class="modal-body success"><div class="success-icon" aria-hidden="true">${icon('check')}</div><div class="eyebrow">IT'S OFFICIAL. YOU'RE GOING.</div><h2>Your campus plans are coming together.</h2><p>Your spot is saved, ${esc(user.name.split(' ')[0])}.<br>Find this pass anytime in My events.</p><div class="ticket"><span class="category-label">CAMPUS CONNECT · DEMO ENTRY PASS</span><strong>${esc(e.title)}</strong><small>${esc(e.dateLabel)} · ${esc(e.time)}<br>${esc(e.location)}<br>Attendee: ${esc(user.name)}</small><div class="ticket-code">CC-${String(e.id).slice(0,8).toUpperCase()}</div></div><button class="primary-btn" id="ticket-calendar">${icon('calendar')} Add to calendar</button><button class="secondary-btn" id="my-events-btn">Go to My events</button><button class="text-button danger" id="cancel-registration">Cancel registration</button></div>`);
 $('#my-events-btn').onclick=()=>{closeModal();navigate('registered');};$('#ticket-calendar').onclick=()=>downloadCalendar(e);
 $('#cancel-registration').onclick=()=>{
  openModal(`<div class="modal-body"><h2>Cancel your spot?</h2><p>You’ll give up your registration for <b>${esc(e.title)}</b>. You can register again later.</p><p id="cancel-error" class="form-error" role="alert" hidden></p><button class="primary-btn danger-button" id="confirm-cancel">Yes, cancel registration</button><button class="secondary-btn" id="keep-registration">Keep my spot</button></div>`);
  $('#keep-registration').onclick=()=>success(e);
  $('#confirm-cancel').onclick=async()=>{
   const button=$('#confirm-cancel');if(button.disabled)return;
   button.disabled=true;button.textContent='Cancelling…';
   try {
    await api.cancelRegistration(e.id);
    registered=registered.filter(id=>id!==e.id);persist();render();closeModal();toast('Registration canceled. You can register again anytime.');
   } catch(error) {
    const message=$('#cancel-error');if(message){message.textContent=error.message||'Cancellation failed. Please try again.';message.hidden=false;}
    button.disabled=false;button.textContent='Yes, cancel registration';
   }
  };
 };
}
function calendarEscape(value){return value.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function makeCalendar(e) {
 if(!e.timestamp)throw new Error('A calendar invite is unavailable until the event time is announced.');
 const start=new Date(e.timestamp),end=new Date(start.getTime()+60*60*1000);
 const toUtc=value=>value.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Campus Connect//Local Demo//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:cc-${e.id}@campusconnect.local`,`DTSTAMP:${toUtc(new Date())}`,`DTSTART:${toUtc(start)}`,`DTEND:${toUtc(end)}`,`SUMMARY:${calendarEscape(e.title)}`,`LOCATION:${calendarEscape(e.location)}`,`DESCRIPTION:${calendarEscape(`Campus Connect demo. Duration and pricing are estimates.`)}`,'END:VEVENT','END:VCALENDAR'];
 // Fold by UTF-8 octets, preserving multibyte characters (RFC 5545).
 return lines.map(line=>{let out='',length=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(length+size>74){out+='\r\n ';length=1;}out+=char;length+=size;}return out;}).join('\r\n')+'\r\n';
}
function downloadCalendar(e) {if(!e.timestamp){toast('A calendar invite is unavailable until the event time is announced.');return;}const url=URL.createObjectURL(new Blob([makeCalendar(e)],{type:'text/calendar;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`campus-connect-${e.dateKey||'event'}.ics`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Calendar invite downloaded. Open it to add the event.');}
const communities=[['discover','The Makers Society','For curious hands and creative minds. Pottery, art, design, and everything in between.',128],['people','Campus Social Society','Coffee dates, shared tables, and the friends you haven’t met yet.',342],['check','Campus Wellbeing Collective','A little more movement. A little more balance. Find your feel-good community.',216],['calendar','Westbridge Developer Club','Build things, share ideas, and meet your next project partner.',189]];
function renderCommunities() {$('#events-grid').className='events-grid';$('#events-grid').innerHTML=communities.map((g,id)=>`<article class="community-card"><span>${icon(g[0])}</span><h3>${g[1]}</h3><p>${g[2]}</p><p>${g[3]+(joined.includes(id)?1:0)} members · Open to everyone</p><button class="${joined.includes(id)?'secondary-btn':'primary-btn'}" data-community="${id}" aria-label="${joined.includes(id)?'Leave':'Join'} ${g[1]}" aria-pressed="${joined.includes(id)}">${joined.includes(id)?'Joined · Leave community':'Join community '+icon('arrow')}</button></article>`).join('');}
function toggleCommunity(id) {
 if(!user){pending={type:'community',id};auth();return;}
 if(joined.includes(id)){
  openModal(`<div class="modal-body"><h2>Leave this community?</h2><p>You’re about to leave <b>${communities[id][1]}</b>. You’re welcome back anytime.</p><button class="primary-btn danger-button" id="confirm-leave">Leave community</button><button class="secondary-btn" id="keep-community">Stay in the community</button></div>`);
  $('#keep-community').onclick=closeModal;$('#confirm-leave').onclick=()=>{joined=joined.filter(i=>i!==id);persist();render();closeModal();toast('You left the community. You can rejoin anytime.');};
 } else {joined.push(id);persist();render();$(`[data-community="${id}"]`)?.focus({preventScroll:true});toast('You’re part of the community!');}
}
const pageInfo={discover:['Find your people.',' Make your plans.','Discover the moments that make campus feel like home.','Your next “why not?”','A full calendar. A campus full of possibilities.','Discover events'],registered:['Your plans.',' All in one place.','Your registrations, entry passes, and next campus memories.','Coming up for you','The moments you’ve said yes to.','My events'],saved:['Good things.',' Saved for later.','Keep the events that caught your eye close at hand.','Your saved events','A little inspiration for your next open afternoon.','Saved events'],communities:['Your interests.',' Your people.','Find a shared interest. Make an unexpected connection.','Find your kind of people','Everyone belongs somewhere. Start here.','Communities']};
function navigate(p) {if(!pageInfo[p])p='discover';if(location.hash!=='#'+p){location.hash=p;}else setPage(p);}
function setPage(p) {
 if(!pageInfo[p])p='discover';page=p;category='All events';calendar=false;$('#search').value='';$('#free-filter').checked=false;$('#date-filter').value='all';$('#filter-btn').setAttribute('aria-expanded','false');
 document.querySelectorAll('[data-page]').forEach(button=>{const active=button.dataset.page===p;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 const info=pageInfo[p];$('h1').innerHTML=esc(info[0])+`<span>${esc(info[1])}</span>`;$('.page-intro p').textContent=info[2];$('#section-title').textContent=info[3];$('#section-description').textContent=info[4];$('#breadcrumb').textContent=info[5];document.title=`${info[5]} · Campus Connect`;
 $('.eyebrow').textContent=p==='discover'?'A LITTLE CURIOSITY. A LOT OF POSSIBILITY.':p==='communities'?'BETTER, TOGETHER.':'YOUR CAMPUS, YOUR WAY.';
 $('.hero').hidden=p!=='discover';$('.intro-doodle').hidden=p!=='discover';$('.community-banner').hidden=p!=='discover';$('.bottom-note').hidden=p!=='discover';$('.filter-row').hidden=p==='communities';
 render();window.scrollTo({top:0,behavior:'auto'});
}
window.addEventListener('hashchange',()=>{if(!$('#modal').hidden)closeModal();setPage(location.hash.slice(1));});
document.addEventListener('click',event=>{
 const save=event.target.closest('[data-save]');if(save){const id=save.dataset.save;saved=saved.includes(id)?saved.filter(i=>i!==id):[...saved,id];persist();render();($(`[data-save="${id}"]`)||$('#empty-action')).focus({preventScroll:true});toast(saved.includes(id)?'Event saved. Find it in Saved events.':'Event removed from Saved events.');return;}
 const ticket=event.target.closest('[data-ticket]');if(ticket){success(events.find(e=>e.id===ticket.dataset.ticket));return;}
 const detailButton=event.target.closest('[data-detail]');if(detailButton){detail(detailButton.dataset.detail);return;}
 const community=event.target.closest('[data-community]');if(community){toggleCommunity(+community.dataset.community);return;}
 const article=event.target.closest('[data-card]');if(article&&!event.target.closest('button,a,input'))detail(article.dataset.card);
});
document.addEventListener('keydown',event=>{
 if($('#modal').hidden)return;
 if(event.key==='Escape'){event.preventDefault();closeModal();return;}
 if(event.key==='Tab'){
  const items=[...$('.modal').querySelectorAll('button,input,a,select,[tabindex="0"]')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);
  if(!items.length){event.preventDefault();return;}
  if(event.shiftKey&&(document.activeElement===items[0]||document.activeElement===$('.modal'))){event.preventDefault();items.at(-1).focus();}
  else if(!event.shiftKey&&(document.activeElement===items.at(-1)||document.activeElement===$('.modal'))){event.preventDefault();items[0].focus();}
 }
});
$('.modal-close').onclick=closeModal;
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))closeModal();});
document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;render();});
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>navigate(button.dataset.page));
$('.skip-link').onclick=event=>{event.preventDefault();$('#events-heading').focus();$('#events-heading').scrollIntoView({behavior:'auto'});};
$('#search').oninput=render;$('#free-filter').onchange=render;$('#date-filter').onchange=render;
$('#filter-btn').onclick=()=>{const open=$('#filter-btn').getAttribute('aria-expanded')!=='true';$('#filter-btn').setAttribute('aria-expanded',String(open));$('#filter-panel').hidden=!open;};
$('#reset-filter').onclick=clearFilters;$('#clear-filters').onclick=clearFilters;
$('#calendar-btn').onclick=()=>{calendar=!calendar;render();};
$('#empty-action').onclick=()=>{if(eventsLoadFailed){loadEvents();return;}if(hasFilters())clearFilters();else if(page==='registered'&&!user){pending=null;auth(true);}else navigate(page==='discover'?'communities':'discover');};
$('#hero-details').onclick=()=>{const feature=events.find(event=>event.timestamp)||events[0];if(feature)detail(feature.id);else toast('No events are available yet.');};
$('#profile-btn').onclick=()=>{
 pending=null;if(!user){auth();return;}
 openModal(`<div class="modal-body"><div class="auth-logo" aria-hidden="true">✳</div><h2>Hey, ${esc(user.name)}.</h2><p>${esc(user.email)}</p><p>You have ${registered.length} registered event${registered.length===1?'':'s'}, ${saved.length} saved event${saved.length===1?'':'s'}, and ${joined.length} communit${joined.length===1?'y':'ies'}.</p><p class="auth-note">This profile is stored only in this browser. Logging out keeps your plans saved for your next login.</p><button class="primary-btn" id="logout">Log out</button></div>`);
 $('#logout').onclick=()=>{persist();user=null;api.setUser(null);write('session',null);restoreProfile();render();closeModal();toast('Logged out. Your plans are saved for your next login.');};
};
$('#explore-btn').onclick=()=>{navigate('discover');requestAnimationFrame(()=>$('#events-heading').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));};
$('#community-btn').onclick=()=>navigate('communities');
$('#notification-btn').onclick=()=>openModal(`<div class="modal-body"><span class="auth-logo">${icon('bell')}</span><h2>Your campus updates</h2><p>${registered.length?`You’re registered for ${registered.length} event${registered.length===1?'':'s'}. Your entry passes are ready in My events.`:'You’re all caught up. Register for an event to start making campus plans.'}</p><button class="primary-btn" id="notifications-events">${registered.length?'Go to My events':'Discover events'}</button></div>`);
document.addEventListener('click',event=>{if(event.target.closest('#notifications-events')){closeModal();navigate(registered.length?'registered':'discover');}});
$('#help-btn').onclick=()=>openModal('<div class="modal-body"><span class="auth-logo" aria-hidden="true">✳</span><h2>A little help finding your way.</h2><p>Search by event name or category. Filter by category or date; the price filter is available when event pricing is listed. Bookmark events to keep them in Saved events.</p><p>Open an event and register to reserve a spot. Your entry passes live in <b>My events</b>, where you can download a calendar invite or cancel a registration.</p><p>Create a local demo account with a sample password. Log in with the same email and password to recover your plans in this browser. Other browsers and devices don’t share your data.</p><p>Events come from Supabase. Dates use the campus timezone; calendar downloads use an estimated one-hour duration. No emails are sent and no payments are collected.</p></div>');
$('#about-btn').onclick=()=>openModal('<div class="modal-body"><span class="auth-logo" aria-hidden="true">✳</span><h2>Campus feels better connected.</h2><p>Campus Connect brings the best of Westbridge University into one place. Discover events, find a community, and make the kind of memories that stick around after the semester ends.</p><p>This is a local prototype with sample events, demo registrations, and browser-local accounts. Westbridge University is a fictional campus.</p></div>');
function normalizeIcons(root) {
 const mapping={'✳':'spark','✶':'spark','↗':'arrow','↘':'arrow','ⓘ':'info','▥':'campus','▦':'calendar','◷':'clock','⌖':'pin','⌄':'chevron'};
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(/[✳✶↗↘ⓘ▥▦◷⌖⌄]/.test(walker.currentNode.textContent))nodes.push(walker.currentNode);
 for(const node of nodes){if(node.parentElement.closest('script,style,svg'))continue;const fragment=document.createDocumentFragment();for(const part of node.textContent.split(/([✳✶↗↘ⓘ▥▦◷⌖⌄])/)){if(mapping[part]){const span=document.createElement('span');span.className='inline-icon';span.innerHTML=icon(mapping[part]);fragment.append(span);}else fragment.append(document.createTextNode(part));}node.replaceWith(fragment);}
}
normalizeIcons(document.body);
// Use actual icons consistently instead of platform-dependent Unicode symbols.
document.querySelectorAll('[data-page]').forEach(button=>{button.querySelector('span').innerHTML=icon(({discover:'discover',registered:'calendar',saved:'bookmark',communities:'people'})[button.dataset.page]);});
$('#notification-btn').innerHTML=icon('bell');$('.search-box>span').innerHTML=icon('search');$('#filter-btn').innerHTML=icon('filter')+'<span>Filters</span>';$('.modal-close').innerHTML=icon('close');
// A missing remote photo must not show a broken-image glyph or hide event text.
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement){event.target.hidden=true;event.target.parentElement.classList.add('image-unavailable');}},true);
$('#results-count').textContent='Loading events…';
loadEvents().then(()=>setPage(location.hash.slice(1)||'discover'));
