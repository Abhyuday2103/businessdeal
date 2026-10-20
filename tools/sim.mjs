import * as E from '../docs/engine.js';
let over=0, rounds=[], errs=0;
for (let g=0; g<300; g++) {
  const st = E.createTable('T','h','Host');
  st.players[0].bot=true;
  const nb = 1 + (g%5);
  for (let k=0;k<nb;k++) E.dispatch(st,'h',{type:'addBot'},0);
  if (g%3===0) E.dispatch(st,'h',{type:'settings',settings:{clubRest:'old',roundLimit:g%2?30:0}},0);
  E.dispatch(st,'h',{type:'start'},0);
  let t=0, steps=0;
  while (st.phase==='play' && steps<60000) {
    t+=1000; steps++;
    try { E.runBots(st,t); } catch(e){ errs++; if (errs<5) console.log('ERR',e.message, st.step, JSON.stringify(st.debts)); break; }
    for (const p of st.players) if (!p.out && p.cash<0) { console.log('neg cash', p.name, p.cash); errs++; }
  }
  if (st.phase==='over') { over++; rounds.push(st.round); }
  else console.log('stuck', st.round, st.players.filter(p=>!p.out).map(p=>p.cash).join('|'), st.step, st.round, JSON.stringify(st.debts), st.trade);
}
rounds.sort((a,b)=>a-b);
console.log({over, errs, median: rounds[rounds.length>>1], max: rounds.at(-1)});
