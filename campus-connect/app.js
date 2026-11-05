import api from './api.js?v=4';

// Landing page elements (declared early for closeModal access)
let landingPage = null;
let appShell = null;

const events=[];
const CAMPUS_TIME_ZONE='Asia/Kolkata';
function eventFromApi(record) {
 if(!record||typeof record.id!=='string'||typeof record.title!=='string'||!record.title.trim())throw new Error('The server returned an invalid event.');
 const parsed=typeof record.timestamp==='string'?new Date(record.timestamp):null;
 const validDate=parsed&&!Number.isNaN(parsed.getTime())?parsed:null;
 const parts=validDate?Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(validDate).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])):null;
 const day=parts?Number(parts.day):null;
 const month=parts?Number(parts.month):null;
 const year=parts?Number(parts.year):null;
 const dateKey=parts?`${parts.year}-${parts.month}-${parts.day}`:null;
 const imageNumber=Array.from(record.id).reduce((sum,char)=>sum+char.charCodeAt(0),0)%8+1;
 const title=record.title.trim();
 const category=/music|fest|concert|band|dance/i.test(title)?'Music & Arts':/yoga|sport|wellness|fitness|mindful/i.test(title)?'Sports & Wellness':/garden|social|community|mixer|party|game/i.test(title)?'Social':/product|design|open source|acid|career|tech|build/i.test(title)?'Tech & Career':'General';
 // Use new fields from API if available, otherwise fall back to defaults
 const location = record.location && record.location.trim() ? record.location.trim() : 'Location to be announced';
 const image = record.image_url && record.image_url.trim() ? record.image_url.trim() : `assets/event-${imageNumber}.jpg`;
 const price = typeof record.price === 'number' && record.price >= 0 ? record.price : null;
 const description = record.description && record.description.trim() ? record.description.trim() : 'The organizer has not added a description yet.';
 const host = record.organiser_name || 'Campus organizer';
 return {
  id:record.id,title,subtitle:description.slice(0,120)+(description.length>120?'…':''),
  category,day,month,year,dateKey,
  dateLabel:validDate?new Intl.DateTimeFormat('en-US',{timeZone:CAMPUS_TIME_ZONE,month:'short',day:'numeric',year:'numeric'}).format(validDate):'Date to be announced',
  monthLabel:validDate?new Intl.DateTimeFormat('en-US',{timeZone:CAMPUS_TIME_ZONE,month:'long',year:'numeric'}).format(validDate):'Date to be announced',
  time:validDate?new Intl.DateTimeFormat('en-US',{timeZone:CAMPUS_TIME_ZONE,hour:'numeric',minute:'2-digit'}).format(validDate):'Time to be announced',
  location,image,
  going:null,capacity:Number.isInteger(record.capacity)&&record.capacity>=0?record.capacity:null,
  price,host,description,
  timestamp:validDate?validDate.toISOString():null
 };
}

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
const validIds = value => Array.isArray(value) ? [...new Set(value.filter(id=>events.some(event=>event.id===id)))] : [];
let user = null;
let saved=[], registered=[], joined=[], category='All events', page='discover', calendar=false, eventsLoadFailed=false;
let pending=null, lastFocus=null;
let users=[], communities=[];
const initials = name => name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
const roleLabel = role => role==='attendee'?'Attendee':role==='organizer'?'Organizer':role==='admin'?'Admin':role;
function profile() {
 $('#event-count').textContent=registered.length;
 const staff=Boolean(user&&(user.role==='organizer'||user.role==='admin'));
 $('#profile-btn').hidden=!staff;
 if(user){$('#avatar').textContent=initials(user.name);$('#avatar').title=`${user.name} (${roleLabel(user.role)})`;}
 else {$('#avatar').innerHTML=icon('people');$('#avatar').title='Guest';}
 syncUserSelects();
}
function toast(message) {$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
async function loadEvents() {
 try {
  const rows=await api.getEvents();
  if(!Array.isArray(rows))throw new Error('The events API returned an invalid response.');
  const loaded=rows.map(eventFromApi);
  events.splice(0,events.length,...loaded);
  eventsLoadFailed=false;
  if(user)await loadUserState();
  render();
 } catch(error) {
  events.splice(0,events.length);
  eventsLoadFailed=true;
  render();
  console.error('Failed to load events:',error);
  toast(error.message||'Events could not be loaded. Check the server connection and try again.');
 }
}
async function loadUserState() {
 const [registrations,savedIds]=await Promise.all([api.getMyRegistrations(),api.getSavedEventIds()]);
 if(!Array.isArray(registrations)||!Array.isArray(savedIds))throw new Error('Saved events and registrations returned an invalid response.');
 registered=[...new Set(registrations.map(row=>row.event_id).filter(id=>events.some(event=>event.id===id)))];
 saved=validIds(savedIds);
}
async function loadUserRegistrations() {
 if(!user)return false;
 try {
  await loadUserState();
  render();
  return true;
 } catch(error) {
  console.error('Failed to load registrations:',error);
  if(expireSession(error))return false;
  toast(error.message||'Your registrations could not be loaded.');
  return false;
 }
}
async function loadCommunities() {
 try {
  communities=await api.getCommunities();
  joined=communities.filter(community=>community.joined).map(community=>community.id);
 } catch(error) {
  console.error('Failed to load communities:',error);
  toast('Communities could not be refreshed. Try again in a moment.');
 }
}
function expireSession(error) {
 if(error?.status!==401)return false;
 if(!$('#modal').hidden)closeModal();
 setCurrentUser(null,{quiet:true}).then(()=>toast('That user is no longer available. Choose a user to continue.'));
 return true;
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
 else if(eventsLoadFailed){title.textContent='Events could not be loaded.';$('#empty-text').textContent='Check that the server is running, then try again.';$('#empty-action').textContent='Try again';}
 else if(page==='registered') {title.textContent=user?'Your next plan starts here.':'Your plans belong here.';$('#empty-text').textContent=user?'Register for an event and your entry pass will appear here.':'Choose a user from the menu at the top right to see their registrations, or discover an event to get started.';$('#empty-action').textContent=user?'Discover events':'Choose a user';}
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
 normalizeIcons($('#modal-content'));
 // Re-attach close button handler since content was replaced
 $('.modal-close').onclick=closeModal;
 $('.modal').scrollTop=0;$('.modal').focus();
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
 $('#register-btn').onclick=()=>{if(registered.includes(id)){success(e);return;}if(!user){requireUser({type:'event',id});return;}confirmRegistration(e);};
}
function activeUserSelect() {
 return landingPage.hidden ? $('#app-user-select') : $('#landing-user-select');
}
function requireUser(action=null) {
 if(!$('#modal').hidden)closeModal();
 pending=action;
 const select=activeUserSelect();
 const switcher=select.closest('.user-switch');
 switcher?.classList.add('is-highlighted');
 setTimeout(()=>switcher?.classList.remove('is-highlighted'),2400);
 select.focus({preventScroll:true});
 toast('Choose a user from the menu at the top right to continue.');
}
function confirmRegistration(e) {
 if(!e||!user)return;
 openModal(`<div class="modal-body"><span class="category-label">YOU'RE ONE STEP AWAY</span><h2>Make it a plan.</h2><p>Reserve your spot for <strong>${esc(e.title)}</strong>.</p><div class="ticket"><strong>${esc(e.title)}</strong><small>${esc(e.dateLabel)} · ${esc(e.time)}<br>${esc(e.location)}</small></div><p>Registering as <b>${esc(user.name)}</b><br>${esc(user.email)}</p><p>No payment is collected by this demo.</p><p id="registration-error" class="form-error" role="alert" hidden></p><button class="primary-btn" id="confirm-btn">Confirm registration ${icon('arrow')}</button><button class="secondary-btn" id="back-detail">Back to event details</button></div>`);
 $('#back-detail').onclick=()=>detail(e.id);
 $('#confirm-btn').onclick=async()=>{
  const button=$('#confirm-btn');if(button.disabled)return;
  button.disabled=true;button.textContent='Saving your spot…';
  try {
   await api.registerForEvent(e.id);
   if(!registered.includes(e.id))registered.push(e.id);
   pending=null;render();success(e);
  } catch(error) {
   if(expireSession(error))return;
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
    registered=registered.filter(id=>id!==e.id);render();closeModal();toast('Registration canceled. You can register again anytime.');
   } catch(error) {
    if(expireSession(error))return;
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
function renderCommunities() {$('#events-grid').className='events-grid';$('#events-grid').innerHTML=communities.map(c=>{const isJoined=joined.includes(c.id);return `<article class="community-card"><span>${icon(c.icon)}</span><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><p>${c.member_count} members · Open to everyone</p><button class="${isJoined?'secondary-btn':'primary-btn'}" data-community="${c.id}" aria-label="${isJoined?'Leave':'Join'} ${esc(c.name)}" aria-pressed="${isJoined}">${isJoined?'Joined · Leave community':'Join community '+icon('arrow')}</button></article>`;}).join('')||'<p>No communities are listed yet.</p>';}
async function toggleCommunity(id) {
 const community=communities.find(item=>item.id===id);
 if(!community)return;
 if(!user){requireUser({type:'community',id});return;}
 if(joined.includes(id)){
  openModal(`<div class="modal-body"><h2>Leave this community?</h2><p>You’re about to leave <b>${esc(community.name)}</b>. You’re welcome back anytime.</p><button class="primary-btn danger-button" id="confirm-leave">Leave community</button><button class="secondary-btn" id="keep-community">Stay in the community</button></div>`);
  $('#keep-community').onclick=closeModal;
  $('#confirm-leave').onclick=async()=>{
   try {
    await api.leaveCommunity(id);
    await loadCommunities();
    render();closeModal();toast('You left the community. You can rejoin anytime.');
   } catch(error) {
    if(expireSession(error)){closeModal();return;}
    closeModal();toast(error.message||'Could not leave this community. Please try again.');
   }
  };
 } else {
  try {
   await api.joinCommunity(id);
   await loadCommunities();
   render();
   $(`[data-community="${id}"]`)?.focus({preventScroll:true});
   toast('You’re part of the community!');
  } catch(error) {
   if(expireSession(error))return;
   toast(error.message||'Could not join this community. Please try again.');
  }
 }
}
async function toggleSaved(id) {
 if(!user){requireUser();return;}
 const wasSaved=saved.includes(id);
 saved=wasSaved?saved.filter(item=>item!==id):[...saved,id];
 render();
 ($(`[data-save="${id}"]`)||$('#empty-action')).focus({preventScroll:true});
 toast(wasSaved?'Event removed from Saved events.':'Event saved. Find it in Saved events.');
 try {
  if(wasSaved)await api.unsaveEvent(id);
  else await api.saveEvent(id);
 } catch(error) {
  if(expireSession(error))return;
  saved=wasSaved?[...saved,id]:saved.filter(item=>item!==id);
  render();
  toast(error.message||'Could not update saved events. Please try again.');
 }
}
async function resumePendingAction() {
 if(!user||!pending)return;
 const action=pending;pending=null;
 if(action.type==='event') {
  const eventToRegister=events.find(event=>event.id===action.id);
  if(eventToRegister)confirmRegistration(eventToRegister);else toast('That event is no longer available.');
  return;
 }
 if(action.type==='community'&&communities.some(item=>item.id===action.id)&&!joined.includes(action.id))await toggleCommunity(action.id);
}
const pageInfo={discover:['Find your people.',' Make your plans.','Discover the moments that make campus feel like home.','Your next “why not?”','A full calendar. A campus full of possibilities.','Discover events'],registered:['Your plans.',' All in one place.','Your registrations, entry passes, and next campus memories.','Coming up for you','The moments you’ve said yes to.','My events'],saved:['Good things.',' Saved for later.','Keep the events that caught your eye close at hand.','Your saved events','A little inspiration for your next open afternoon.','Saved events'],communities:['Your interests.',' Your people.','Find a shared interest. Make an unexpected connection.','Find your kind of people','Everyone belongs somewhere. Start here.','Communities']};
function navigate(p) {if(!pageInfo[p])p='discover';if(location.hash!=='#'+p){location.hash=p;}else setPage(p);}
function setPage(p) {
 if(!pageInfo[p])p='discover';page=p;category='All events';calendar=false;$('#search').value='';$('#free-filter').checked=false;$('#date-filter').value='all';$('#filter-btn').setAttribute('aria-expanded','false');
 document.querySelectorAll('[data-page]').forEach(button=>{const active=button.dataset.page===p;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 const info=pageInfo[p];$('#app-shell .page-intro h1').innerHTML=esc(info[0])+`<span>${esc(info[1])}</span>`;$('#app-shell .page-intro p').textContent=info[2];$('#section-title').textContent=info[3];$('#section-description').textContent=info[4];$('#breadcrumb').textContent=info[5];document.title=`${info[5]} · Campus Connect`;
 $('#app-shell .eyebrow').textContent=p==='discover'?'A LITTLE CURIOSITY. A LOT OF POSSIBILITY.':p==='communities'?'BETTER, TOGETHER.':'YOUR CAMPUS, YOUR WAY.';
 $('#app-shell .hero').hidden=p!=='discover';$('.intro-doodle').hidden=p!=='discover';$('.community-banner').hidden=p!=='discover';$('.bottom-note').hidden=p!=='discover';$('.filter-row').hidden=p==='communities';
 render();window.scrollTo({top:0,behavior:'auto'});
}
window.addEventListener('hashchange',()=>{if(!$('#modal').hidden)closeModal();setPage(location.hash.slice(1));});
document.addEventListener('click',event=>{
 const save=event.target.closest('[data-save]');if(save){toggleSaved(save.dataset.save);return;}
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
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))closeModal();});
document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;render();});
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>navigate(button.dataset.page));
$('.skip-link').onclick=event=>{event.preventDefault();$('#events-heading').focus();$('#events-heading').scrollIntoView({behavior:'auto'});};
$('#search').oninput=render;$('#free-filter').onchange=render;$('#date-filter').onchange=render;
$('#filter-btn').onclick=()=>{const open=$('#filter-btn').getAttribute('aria-expanded')!=='true';$('#filter-btn').setAttribute('aria-expanded',String(open));$('#filter-panel').hidden=!open;};
$('#reset-filter').onclick=clearFilters;$('#clear-filters').onclick=clearFilters;
$('#calendar-btn').onclick=()=>{calendar=!calendar;render();};
$('#empty-action').onclick=()=>{if(eventsLoadFailed){loadEvents();return;}if(hasFilters())clearFilters();else if(page==='registered'&&!user){requireUser();}else navigate(page==='discover'?'communities':'discover');};
$('#hero-details').onclick=()=>{const feature=events.find(event=>event.timestamp)||events[0];if(feature)detail(feature.id);else toast('No events are available yet.');};
function openDashboardMenu() {
 const isAdmin=user.role==='admin';
 openModal(`<div class="modal-body"><div class="auth-logo" aria-hidden="true">✳</div><h2>Hey, ${esc(user.name)}.</h2><p>${esc(user.email)} · ${esc(roleLabel(user.role))}</p><p>You have ${registered.length} registered event${registered.length===1?'':'s'}, ${saved.length} saved event${saved.length===1?'':'s'}, and ${joined.length} communit${joined.length===1?'y':'ies'}.</p><button class="primary-btn" id="create-event-btn">${icon('spark')} Create Event</button><button class="secondary-btn" id="organizer-dashboard-btn">${icon('calendar')} Organizer Dashboard</button>${isAdmin?`<button class="secondary-btn" id="admin-dashboard-btn">${icon('campus')} Admin Dashboard</button>`:''}</div>`);
 $('#create-event-btn').onclick=()=>{closeModal();openEventForm();};
 $('#organizer-dashboard-btn').onclick=()=>{closeModal();openOrganizerDashboard();};
 if(isAdmin)$('#admin-dashboard-btn').onclick=()=>{closeModal();openAdminDashboard();};
}
$('#profile-btn').onclick=()=>{if(!user){requireUser();return;}if(user.role==='organizer'||user.role==='admin')openDashboardMenu();};
$('#explore-btn').onclick=()=>{navigate('discover');requestAnimationFrame(()=>$('#events-heading').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));};
$('#community-btn').onclick=()=>navigate('communities');
$('#notification-btn').onclick=()=>openModal(`<div class="modal-body"><span class="auth-logo">${icon('bell')}</span><h2>Your campus updates</h2><p>${registered.length?`You’re registered for ${registered.length} event${registered.length===1?'':'s'}. Your entry passes are ready in My events.`:'You’re all caught up. Register for an event to start making campus plans.'}</p><button class="primary-btn" id="notifications-events">${registered.length?'Go to My events':'Discover events'}</button></div>`);
document.addEventListener('click',event=>{if(event.target.closest('#notifications-events')){closeModal();navigate(registered.length?'registered':'discover');}});
$('#help-btn').onclick=()=>openModal('<div class="modal-body"><span class="auth-logo" aria-hidden="true">✳</span><h2>A little help finding your way.</h2><p>Use the <b>Viewing as</b> menu at the top right to pick a sample user. Choose <b>Browse as guest</b> to look around without a user. Saving events, joining communities and registering all need a chosen user.</p><p>Search by event name or category. Filter by category or date; the price filter is available when event pricing is listed. Bookmark events to keep them in Saved events.</p><p>Open an event and register to reserve a spot. Your entry passes live in <b>My events</b>, where you can download a calendar invite or cancel a registration.</p><p>Saved events, registrations and communities are stored on the Campus Connect server and shown for whichever user you choose. Dates use the campus timezone; calendar downloads use an estimated one-hour duration. No payments are collected.</p></div>');
$('#about-btn').onclick=()=>openModal('<div class="modal-body"><span class="auth-logo" aria-hidden="true">✳</span><h2>Campus feels better connected.</h2><p>Campus Connect brings the best of Westbridge University into one place. Discover events, find a community, and make the kind of memories that stick around after the semester ends.</p><p>This build has no sign-in. Pick any sample user to explore the attendee, organizer or admin experience. Events, registrations, saved events and communities are stored by the Campus Connect API. Westbridge University is a fictional campus.</p></div>');
function normalizeIcons(root) {
 const mapping={'✳':'spark','✶':'spark','↗':'arrow','↘':'arrow','ⓘ':'info','▥':'campus','▦':'calendar','◷':'clock','⌖':'pin','⌄':'chevron'};
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(/[✳✶↗↘ⓘ▥▦◷⌖⌄]/.test(walker.currentNode.textContent))nodes.push(walker.currentNode);
 for(const node of nodes){if(node.parentElement.closest('script,style,svg'))continue;const fragment=document.createDocumentFragment();for(const part of node.textContent.split(/([✳✶↗↘ⓘ▥▦◷⌖⌄])/)){if(mapping[part]){const span=document.createElement('span');span.className='inline-icon';span.innerHTML=icon(mapping[part]);fragment.append(span);}else fragment.append(document.createTextNode(part));}node.replaceWith(fragment);}
}
normalizeIcons(document.body);
// Navigation icons are now inline SVGs in HTML, no need to replace
$('#notification-btn').innerHTML=icon('bell');$('#filter-btn').innerHTML=icon('filter')+'<span>Filters</span>';$('.modal-close').innerHTML=icon('close');
// A missing remote photo must not show a broken-image glyph or hide event text.
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement){event.target.hidden=true;event.target.parentElement.classList.add('image-unavailable');}},true);

// Event creation/edit form
function toCampusInput(date) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:CAMPUS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function openEventForm(eventToEdit = null) {
 const isEdit = !!eventToEdit;
 const e = eventToEdit || {};
 const today = new Date();
 const defaultDate = e.timestamp ? new Date(e.timestamp) : new Date(today.getTime() + 7*24*60*60*1000);
 const dateStr = toCampusInput(defaultDate); // YYYY-MM-DDTHH:MM in campus time
 
 openModal(`<div class="modal-body event-form-modal">
  <span class="category-label">${isEdit ? 'EDIT EVENT' : 'CREATE EVENT'}</span>
  <h2>${isEdit ? 'Update your event' : 'Create a new event'}</h2>
  <form id="event-form">
   <input type="hidden" name="event_id" value="${esc(e.id || '')}">
   <label class="form-field">Event Title<input name="title" placeholder="Product Builders Meetup" value="${esc(e.title || '')}" required maxlength="120"></label>
   <label class="form-field">Date & Time<input name="timestamp" type="datetime-local" value="${esc(dateStr)}" required></label>
   <label class="form-field">Location<input name="location" placeholder="Main Auditorium, Westbridge University" value="${esc(e.location || '')}" maxlength="200"></label>
   <label class="form-field">Capacity (optional)<input name="capacity" type="number" min="0" placeholder="120" value="${esc(e.capacity !== null && e.capacity !== undefined ? e.capacity : '')}"></label>
   <label class="form-field">Price (USD)<input name="price" type="number" min="0" step="0.01" placeholder="0" value="${esc(e.price !== null && e.price !== undefined ? e.price : '0')}"></label>
   <label class="form-field">Image path or URL (optional)<input name="image_url" type="text" maxlength="2048" placeholder="assets/event-1.jpg or https://..." value="${esc(e.image_url || '')}"></label>
   <label class="form-field">Description<textarea name="description" rows="4" placeholder="Tell attendees what this event is about...">${esc(e.description || '')}</textarea></label>
   <p id="event-form-error" class="form-error" role="alert" hidden></p>
   <div class="form-actions">
    <button type="button" class="secondary-btn" id="cancel-event-form">Cancel</button>
    <button type="submit" class="primary-btn">${isEdit ? 'Save Changes' : 'Create Event'} ${icon('arrow')}</button>
   </div>
  </form>
 </div>`);
 
 $('#cancel-event-form').onclick = () => closeModal();
 
 $('#event-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  if (submit.disabled) return;
  
  const data = new FormData(form);
  const eventId = data.get('event_id');
  const isEdit = !!eventId;
  
  const eventData = {
   title: String(data.get('title') || '').trim(),
   timestamp: String(data.get('timestamp') || ''),
   location: String(data.get('location') || '').trim() || null,
   capacity: data.get('capacity') ? parseInt(data.get('capacity'), 10) : null,
   price: data.get('price') ? parseFloat(data.get('price')) : 0,
   image_url: String(data.get('image_url') || '').trim() || null,
   description: String(data.get('description') || '').trim() || null,
  };
  
  const showError = (message) => {
   const errorEl = $('#event-form-error');
   errorEl.textContent = message;
   errorEl.hidden = false;
  };
  
  // Validation
  if (!eventData.title) {
   showError('Event title is required.');
   return;
  }
  if (!eventData.timestamp) {
   showError('Date & time is required.');
   return;
  }
  if (eventData.capacity !== null && (isNaN(eventData.capacity) || eventData.capacity < 0)) {
   showError('Capacity must be a non-negative number.');
   return;
  }
  if (isNaN(eventData.price) || eventData.price < 0) {
   showError('Price must be a non-negative number.');
   return;
  }
  
  submit.disabled = true;
  submit.textContent = isEdit ? 'Saving…' : 'Creating…';
  $('#event-form-error').hidden = true;
  
  try {
   let result;
   if (isEdit) {
    result = await api.updateEvent(eventId, eventData);
   } else {
    result = await api.createEvent(eventData);
   }
   closeModal();
   toast(isEdit ? 'Event updated successfully!' : 'Event created successfully!');
   await loadEvents();
  } catch (error) {
   console.error('Event form error:', error);
   showError(error.message || 'Failed to save event. Please try again.');
  } finally {
   if (form.isConnected) {
    submit.disabled = false;
    submit.textContent = isEdit ? 'Save Changes' + ' ' + icon('arrow') : 'Create Event' + ' ' + icon('arrow');
   }
  }
 };
}

// Organizer Dashboard
function openOrganizerDashboard() {
 openModal(`<div class="modal-body organizer-dashboard-modal" style="max-width: 900px; max-height: 80vh; overflow-y: auto;">
  <span class="category-label">ORGANIZER DASHBOARD</span>
  <h2>Your Events</h2>
  <div id="organizer-stats" class="organizer-stats">Loading…</div>
  <div class="organizer-actions">
   <button class="primary-btn" id="create-event-from-dashboard">${icon('spark')} Create New Event</button>
  </div>
  <div id="organizer-events" class="organizer-events">Loading…</div>
 </div>`);
 
 loadOrganizerDashboard();
 
 $('#create-event-from-dashboard').onclick = () => {
  closeModal();
  openEventForm();
 };
}

async function loadOrganizerDashboard() {
 if (!user) return;
 
 try {
  // Get organizer's events
  const events = await api.getMyEvents();
  
  // Get registration counts for each event
  let registrationCounts = {};
  
  await Promise.all(events.map(async event => {
   registrationCounts[event.id] = await api.getEventRegistrationCount(event.id);
  }));
  
  // Render stats
  const totalEvents = events.length;
  const totalRegistrations = Object.values(registrationCounts).reduce((a, b) => a + b, 0);
  const upcomingEvents = events.filter(e => e.timestamp && new Date(e.timestamp) > new Date()).length;
  
  $('#organizer-stats').innerHTML = `
   <div class="stat-card"><h3>${totalEvents}</h3><p>Total Events</p></div>
   <div class="stat-card"><h3>${totalRegistrations}</h3><p>Total Registrations</p></div>
   <div class="stat-card"><h3>${upcomingEvents}</h3><p>Upcoming Events</p></div>
  `;
  
  // Render events table
  if (events.length === 0) {
   $('#organizer-events').innerHTML = `
    <div class="empty-dashboard">
     <p>You haven't created any events yet.</p>
     <button class="primary-btn" id="create-first-event">${icon('spark')} Create Your First Event</button>
    </div>
   `;
   $('#create-first-event').onclick = () => {
    closeModal();
    openEventForm();
   };
   return;
  }
  
  $('#organizer-events').innerHTML = `
   <table class="organizer-table">
    <thead>
     <tr><th>Event</th><th>Date & Time</th><th>Location</th><th>Capacity</th><th>Registrations</th><th>Status</th><th>Actions</th></tr>
    </thead>
    <tbody>
     ${events.map(e => {
      const regCount = registrationCounts[e.id] || 0;
      const isPast = e.timestamp && new Date(e.timestamp) < new Date();
      const isFull = e.capacity !== null && regCount >= e.capacity;
      let statusClass = 'upcoming';
      let statusText = 'Upcoming';
      if (isPast) { statusClass = 'past'; statusText = 'Past'; }
      else if (isFull) { statusClass = 'full'; statusText = 'Full'; }
      
      return `
       <tr data-event-id="${esc(e.id)}">
        <td><strong>${esc(e.title)}</strong></td>
        <td>${e.timestamp ? new Date(e.timestamp).toLocaleString() : 'TBA'}</td>
        <td>${esc(e.location || 'TBA')}</td>
        <td>${e.capacity !== null ? e.capacity : 'Unlimited'}</td>
        <td>${regCount}${e.capacity !== null ? ' / ' + e.capacity : ''}</td>
        <td><span class="status-badge status-${statusClass}">${statusText}</span></td>
        <td>
         <button class="secondary-btn edit-event-btn" data-event-id="${esc(e.id)}">${icon('chevron')} Edit</button>
         <button class="danger-btn delete-event-btn" data-event-id="${esc(e.id)}">${icon('close')} Delete</button>
         <button class="secondary-btn view-registrations-btn" data-event-id="${esc(e.id)}">${icon('people')} View Registrations</button>
        </td>
       </tr>
      `;
     }).join('')}
    </tbody>
   </table>
  `;
  
  // Setup event actions
  document.querySelectorAll('.edit-event-btn').forEach(btn => {
   btn.onclick = async () => {
    const eventId = btn.dataset.eventId;
    try {
     const event = await api.getEvent(eventId);
     closeModal();
     openEventForm(event);
    } catch (error) {
     console.error('Failed to load event:', error);
     toast('Failed to load event.');
    }
   };
  });
  
  document.querySelectorAll('.delete-event-btn').forEach(btn => {
   btn.onclick = async () => {
    const eventId = btn.dataset.eventId;
    if (!confirm('Delete this event? This will also delete all registrations.')) return;
    try {
     await api.deleteEvent(eventId);
     toast('Event deleted.');
     await loadEvents();
     loadOrganizerDashboard();
    } catch (error) {
     console.error('Failed to delete event:', error);
     toast('Failed to delete event.');
    }
   };
  });
  
  document.querySelectorAll('.view-registrations-btn').forEach(btn => {
   btn.onclick = async () => {
    const eventId = btn.dataset.eventId;
    try {
     const registrations = await api.getEventRegistrations(eventId);
     const event = events.find(e => e.id === eventId);
     showEventRegistrations(event, registrations);
    } catch (error) {
     console.error('Failed to load registrations:', error);
     toast('Failed to load registrations.');
    }
   };
  });
  
 } catch (error) {
  console.error('Failed to load organizer dashboard:', error);
  $('#organizer-stats').innerHTML = '<p class="form-error">Failed to load dashboard.</p>';
  $('#organizer-events').innerHTML = '<p class="form-error">Failed to load events.</p>';
 }
}

function showEventRegistrations(event, registrations) {
 openModal(`<div class="modal-body registrations-modal" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
  <span class="category-label">EVENT REGISTRATIONS</span>
  <h2>${esc(event.title)}</h2>
  <p>${registrations.length} registration${registrations.length !== 1 ? 's' : ''}</p>
  <table class="registrations-table">
   <thead><tr><th>Email</th><th>Registered</th></tr></thead>
   <tbody>
    ${registrations.map(r => `
     <tr>
      <td>${esc(r.user_email || 'Attendee')}</td>
      <td>${r.created_at ? esc(new Date(r.created_at).toLocaleString()) : 'Unknown'}</td>
     </tr>
    `).join('')}
   </tbody>
  </table>
  <button class="primary-btn" id="close-registrations">Close</button>
 </div>`);
 
 $('#close-registrations').onclick = () => {
  closeModal();
  openOrganizerDashboard();
 };
}

// Admin Dashboard
function openAdminDashboard() {
 openModal(`<div class="modal-body admin-dashboard-modal" style="max-width: 900px; max-height: 80vh; overflow-y: auto;">
  <span class="category-label">ADMIN DASHBOARD</span>
  <h2>System Overview</h2>
  <div id="admin-stats" class="admin-stats">Loading…</div>
  <div class="admin-tabs">
   <button class="admin-tab active" data-admin-tab="users">Users</button>
   <button class="admin-tab" data-admin-tab="events">Events</button>
   <button class="admin-tab" data-admin-tab="registrations">Registrations</button>
  </div>
  <div id="admin-content" class="admin-content">Loading…</div>
 </div>`);
 
 loadAdminStats();
 loadAdminTab('users');
 
 document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.onclick = () => {
   document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
   btn.classList.add('active');
   loadAdminTab(btn.dataset.adminTab);
  };
 });
}

async function loadAdminStats() {
 try {
  const stats = await api.getAdminStats();
  $('#admin-stats').innerHTML = `
   <div class="stat-card"><h3>${stats.total_events}</h3><p>Total Events</p></div>
   <div class="stat-card"><h3>${stats.total_registrations}</h3><p>Total Registrations</p></div>
   <div class="stat-card"><h3>${stats.users.attendee || 0}</h3><p>Attendees</p></div>
   <div class="stat-card"><h3>${stats.users.organizer || 0}</h3><p>Organizers</p></div>
   <div class="stat-card"><h3>${stats.users.admin || 0}</h3><p>Admins</p></div>
  `;
 } catch (error) {
  console.error('Failed to load admin stats:', error);
  $('#admin-stats').innerHTML = '<p class="form-error">Failed to load statistics.</p>';
 }
}

async function loadAdminTab(tab) {
 const content = $('#admin-content');
 content.innerHTML = 'Loading…';
 
 try {
  if (tab === 'users') {
   const data = await api.getAdminUsers(1, 50);
   content.innerHTML = renderAdminUsersTable(data.users);
   setupAdminUserActions();
  } else if (tab === 'events') {
   const data = await api.getAdminEvents(1, 50);
   content.innerHTML = renderAdminEventsTable(data.events);
   setupAdminEventActions();
  } else if (tab === 'registrations') {
   const data = await api.getAdminRegistrations(1, 50);
   content.innerHTML = renderAdminRegistrationsTable(data.registrations);
  }
 } catch (error) {
  console.error('Failed to load admin tab:', error);
  content.innerHTML = '<p class="form-error">Failed to load data.</p>';
 }
}

function renderAdminUsersTable(users) {
 if (!users.length) return '<p>No users found.</p>';
 return `
  <table class="admin-table">
   <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
   <tbody>
    ${users.map(u => `
     <tr data-user-id="${esc(u.id)}">
      <td>${esc(u.id.slice(0,8))}…</td>
      <td>${esc(u.email)}</td>
      <td><span class="role-badge role-${u.role}">${esc(u.role)}</span></td>
      <td>
       <select class="role-select" data-user-id="${esc(u.id)}">
        <option value="attendee" ${u.role==='attendee'?'selected':''}>Attendee</option>
        <option value="organizer" ${u.role==='organizer'?'selected':''}>Organizer</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
       </select>
       <button class="danger-btn delete-user-btn" data-user-id="${esc(u.id)}" ${u.role==='admin'?'disabled':''}>Delete</button>
      </td>
     </tr>
    `).join('')}
   </tbody>
  </table>
 `;
}

function renderAdminEventsTable(events) {
 if (!events.length) return '<p>No events found.</p>';
 return `
  <table class="admin-table">
   <thead><tr><th>ID</th><th>Title</th><th>Organizer</th><th>Date</th><th>Capacity</th><th>Registrations</th><th>Actions</th></tr></thead>
   <tbody>
    ${events.map(e => `
     <tr data-event-id="${esc(e.id)}">
      <td>${esc(e.id.slice(0,8))}…</td>
      <td>${esc(e.title)}</td>
      <td>${esc(e.organiser_email || 'Unknown')}</td>
      <td>${e.timestamp ? new Date(e.timestamp).toLocaleDateString() : 'TBA'}</td>
      <td>${e.capacity !== null ? e.capacity : 'Unlimited'}</td>
      <td>${e.registration_count || 0}</td>
      <td>
       <button class="secondary-btn edit-event-btn" data-event-id="${esc(e.id)}">Edit</button>
       <button class="danger-btn delete-event-btn" data-event-id="${esc(e.id)}">Delete</button>
      </td>
     </tr>
    `).join('')}
   </tbody>
  </table>
 `;
}

function renderAdminRegistrationsTable(registrations) {
 if (!registrations.length) return '<p>No registrations found.</p>';
 return `
  <table class="admin-table">
   <thead><tr><th>ID</th><th>Event</th><th>User</th><th>Date</th></tr></thead>
   <tbody>
    ${registrations.map(r => `
     <tr>
      <td>${esc(r.id.slice(0,8))}…</td>
      <td>${esc(r.event_title)}</td>
      <td>${esc(r.user_email)}</td>
      <td>${r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Unknown'}</td>
     </tr>
    `).join('')}
   </tbody>
  </table>
 `;
}

function setupAdminUserActions() {
 document.querySelectorAll('.role-select').forEach(select => {
  select.onchange = async (e) => {
   const userId = e.target.dataset.userId;
   const newRole = e.target.value;
   try {
    await api.updateAdminUser(userId, newRole);
    await refreshUsers();
    toast('User role updated.');
    loadAdminStats();
   } catch (error) {
    console.error('Failed to update user role:', error);
    toast('Failed to update role.');
    loadAdminTab('users'); // Reset dropdown
   }
  };
 });
 
 document.querySelectorAll('.delete-user-btn').forEach(btn => {
  btn.onclick = async () => {
   const userId = btn.dataset.userId;
   if (!confirm('Delete this user? This cannot be undone.')) return;
   try {
    await api.deleteAdminUser(userId);
    await refreshUsers();
    toast('User deleted.');
    loadAdminStats();
    loadAdminTab('users');
   } catch (error) {
    console.error('Failed to delete user:', error);
    toast('Failed to delete user.');
   }
  };
 });
}

function setupAdminEventActions() {
 document.querySelectorAll('.edit-event-btn').forEach(btn => {
  btn.onclick = async () => {
   const eventId = btn.dataset.eventId;
   try {
    const event = await api.getAdminEvent(eventId);
    closeModal();
    openEventForm(event);
   } catch (error) {
    console.error('Failed to load event:', error);
    toast('Failed to load event.');
   }
  };
 });
 
 document.querySelectorAll('.delete-event-btn').forEach(btn => {
  btn.onclick = async () => {
   const eventId = btn.dataset.eventId;
   if (!confirm('Delete this event? This will also delete all registrations.')) return;
   try {
    await api.deleteAdminEvent(eventId);
    toast('Event deleted.');
    await loadEvents();
    loadAdminStats();
    loadAdminTab('events');
   } catch (error) {
    console.error('Failed to delete event:', error);
    toast('Failed to delete event.');
   }
  };
 });
}

$('#results-count').textContent='Loading events…';

// Landing page elements (assign to already declared variables)
landingPage = $('#landing-page');
appShell = $('#app-shell');

function showLandingPage() {
  if (landingPage && appShell) {
    landingPage.hidden = false;
    appShell.hidden = true;
    document.body.classList.add('landing-mode');
  }
}

function showAppShell() {
  if (landingPage && appShell) {
    landingPage.hidden = true;
    appShell.hidden = false;
    document.body.classList.remove('landing-mode');
  }
}

function enterCampus() {
  showAppShell();
  navigate(location.hash.slice(1) || 'discover');
}

function populateUserSelects() {
  const groups = [['admin', 'Admins'], ['organizer', 'Organizers'], ['attendee', 'Attendees']];
  const options = `<option value="">Browse as guest</option>` + groups.map(([role, label]) => {
    const members = users.filter(item => item.role === role);
    return members.length
      ? `<optgroup label="${label}">${members.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</optgroup>`
      : '';
  }).join('');
  document.querySelectorAll('[data-user-select]').forEach(select => { select.innerHTML = options; });
  syncUserSelects();
}

function syncUserSelects() {
  document.querySelectorAll('[data-user-select]').forEach(select => { select.value = user ? user.id : ''; });
}

async function refreshUsers() {
  try {
    users = await api.getUsers();
    populateUserSelects();
  } catch (error) {
    console.error('Failed to refresh sample users:', error);
  }
}

async function setCurrentUser(userId, { quiet = false } = {}) {
  await refreshUsers();
  const next = userId ? users.find(item => item.id === userId) : null;
  if (userId && !next) {
    toast('That user is no longer available.');
    userId = null;
  }
  api.setUser(userId);
  user = null;
  if (next && userId) {
    try {
      user = { ...next, ...(await api.getMe()) };
    } catch (error) {
      console.error('Failed to load the selected user:', error);
      api.setUser(null);
      toast(error.message || 'That user could not be loaded.');
    }
  }
  saved = [];
  registered = [];
  joined = [];
  await loadCommunities();
  if (user) {
    try {
      await loadUserState();
    } catch (error) {
      console.error('Failed to load the selected user:', error);
      if (!expireSession(error)) toast(error.message || 'Saved events and registrations could not be loaded.');
    }
  }
  render();
  if (!quiet) {
    if (user) toast(`Now viewing as ${user.name} (${roleLabel(user.role)}).`);
    else toast('Browsing as a guest. Choose a user to save, join or register.');
  }
  if (user) await resumePendingAction();
}

document.querySelectorAll('[data-user-select]').forEach(select => {
  select.addEventListener('change', async () => {
    await setCurrentUser(select.value || null);
    if (!landingPage.hidden) enterCampus();
  });
});
$('#landing-enter').onclick = enterCampus;
$('#landing-cta-enter').onclick = enterCampus;
$('#landing-final-enter').onclick = enterCampus;
$('#landing-cta-choose').onclick = () => { $('#landing-user-select').focus(); };

async function startApp() {
  try {
    users = await api.getUsers();
  } catch (error) {
    console.error('Failed to load sample users:', error);
    users = [];
    toast('The sample user list could not be loaded.');
  }
  populateUserSelects();

  const rememberedId = api.restoreUser();
  user = null;
  const remembered = rememberedId ? users.find(item => item.id === rememberedId) : null;
  if (remembered) {
    try {
      user = { ...remembered, ...(await api.getMe()) };
    } catch (error) {
      console.error('Could not restore the selected user:', error);
      toast('Your previously selected user could not be restored. Choose a user to continue.');
    }
  }
  if (!user) api.setUser(null);

  await loadEvents();
  await loadCommunities();
  if (user || location.hash.length > 1) showAppShell();
  else showLandingPage();
  setPage(location.hash.slice(1) || 'discover');
  if (user) render();
  syncUserSelects();
}
startApp();
