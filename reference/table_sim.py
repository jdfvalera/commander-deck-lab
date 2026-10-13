"""4-player table simulation: Pride of Hull Clade vs three Foundations Commander precons.
Opponents are modelled from their real decklists (interaction counts, evasion, board growth),
not played card-by-card."""
import random, statistics
from collections import Counter
import goldfish as gf

C = gf.C

# ---------- opponent archetypes (counts taken from the published decklists) ----------
OPP = {
  'Tramplesaurus Rex (G stompy)': dict(
      wipes=['predation'],                      # Ezuri's Predation: 4/4s fight -> kills toughness<=4
      spot=4,                                   # Beast Within, Bite Down, Ram Through, Kenrith's Transformation
      counters=0, aetherize=0, propaganda=False,
      flying=False, trample=True, blocker_t=6,
      power=[0,0,2,5,8,12,16,21,26,31,36,40,44,48,52,56,60,64,68,72],
      extra_draw=0.3),
  'Calling All Angels (W fliers)': dict(
      wipes=['destroy_creatures']*3,            # Austere Command, Cleansing Nova, Day of Judgment
      spot=5,                                   # Swords, Fateful Absence, Destroy Evil, Valorous Stance, Exorcise
      counters=0, aetherize=0, propaganda=False,
      flying=True, trample=False, blocker_t=4,
      power=[0,0,2,4,7,10,14,18,22,26,30,34,38,42,46,50,54,58,62,66],
      extra_draw=0.5),
  'Keen Engineering (U artifacts)': dict(
      wipes=['disk','all_is_dust'],             # Nevinyrral's Disk, All Is Dust
      spot=3,                                   # Fall from Favor, Launch Mishap, Duplicant
      counters=2, aetherize=1, propaganda=True, # Counterspell, Negate; Aetherize; Propaganda
      flying=True, trample=False, blocker_t=1,
      power=[0,1,2,3,5,7,9,12,15,18,21,24,27,30,33,36,39,42,45,48],
      extra_draw=0.8),
  'Reign of Dragons (R dragons)': dict(
      wipes=['blasphemous','chain_reaction','magmaquake'],
      spot=3,                                   # Lightning Bolt, Abrade, Chaos Warp
      counters=0, aetherize=0, propaganda=False,
      flying=True, trample=False, blocker_t=5,
      power=[0,0,1,3,6,9,13,17,22,27,32,37,42,47,52,57,62,67,72,77],
      extra_draw=0.3),
}

FLIERS = {'Drift of Phantasms','Hover Barrier','Final-Word Phantom','Ornithopter','Ornithopter of Paradise',
          'Esior, Wardwing Familiar','Trygon Predator','Horizon Chimera'}
REACH = {'Fecund Greenshell','Wall of Tanglecord'}
UNBLOCKABLE = {'Cephalid Facetaker','Elusive Krasis'}
# per-turn "make one creature unblockable" sources: name -> mana cost
ENABLERS = {'Key to the City':2,'Suspicious Bookcase':3,"Rogue's Passage":4,'Access Tunnel':3}
LAND_ENABLERS = {"Rogue's Passage",'Access Tunnel'}

class Opp:
    def __init__(s, name, rng):
        s.name = name; s.a = OPP[name]; s.rng = rng
        s.life = 40; s.poison = 0; s.pmult = 1.0
        n_w = len(s.a['wipes']); lib = (['W']*n_w + ['S']*s.a['spot'] + ['K']*s.a['counters'] +
                                        ['A']*s.a['aetherize'] + ['x']*(99 - n_w - s.a['spot'] - s.a['counters'] - s.a['aetherize']))
        rng.shuffle(lib); s.lib = lib
        s.hand = Counter(); s.wipes_left = list(s.a['wipes']); rng.shuffle(s.wipes_left)
        for _ in range(7): s.draw()
        s.acc = 0.0
    def draw(s):
        if s.lib: s.hand[s.lib.pop()] += 1
    def alive(s): return s.life > 0 and s.poison < 10
    def power(s, t): return s.a['power'][min(t, len(s.a['power']))-1] * s.pmult
    def nblockers(s, t):
        p = s.power(t); per = 1 if s.a['blocker_t'] == 1 else 4
        return 0 if p <= 0 else min(4, max(1, int(p // per)))

class TableGame(gf.Game):
    def __init__(s, deck, seed, opp_names):
        super().__init__(deck, seed)
        s.opps = [Opp(n, random.Random(seed*7+i)) for i, n in enumerate(opp_names)]
        s.opp = s.opps  # not used for life now
        s.life = 40; s.tax = 0; s.why = None
        s.stats = Counter()
    # override alive to use Opp objects
    def alive(s): return [o for o in s.opps if o.alive()]
    def has(s, name): return any(c['name'] == name for c in s.bf)
    def in_play(s, name): return name in s.perms or s.has(name) or name in s.land_names
    @property
    def land_names(s): return getattr(s, '_lands', set())

    # ---- draws: Crawler pings Opp objects ----
    def draw(s, n, step=False):
        mult = 2 if 'archive' in s.perms else 1
        k = 0
        for i in range(n):
            amt = 1 if (step and i == 0) else mult
            for _ in range(amt):
                if not s.lib: s.decked = True; return k
                card = s.lib.pop(); s.hand.append(card); k += 1
        s.drawn_total += k
        if any(C[c['name']].get('crawler') for c in s.bf):
            for o in s.alive(): o.life -= k
        return k

    # ---- evasion: can creature c get through to opponent o this turn? ----
    def evasive(s, c, o, t):
        if o.power(t) <= 0: return True
        n = c['name']
        if n in UNBLOCKABLE: return True
        if s.has('Tetsuko Umezawa, Fugitive') and (s.power(c)+1 <= 1 or s.tough(c) <= 1): return True
        if c.get('helm'): return True
        if n in FLIERS and not o.a['flying']: return True
        return False

    def play_turn(s):
        s.turn += 1; t = s.turn
        for c in s.bf: c['sick'] = False
        s.pride_sick = False if s.pride else True
        s.draw(1, step=True)
        if s.decked: return 'decked'
        for c in list(s.hand):
            if C[c]['kind'] == 'land':
                s.hand.remove(c); s.lands += 1; s._lands = s.land_names | {c}; break
        mana = s.mana_available()
        res = s.try_triumph_table(mana)
        if res: return res
        mana = getattr(s, '_mana_after', mana)
        # commander
        def cast_pride(m):
            if s.pride: return m
            cost = max(1, 11 - s.total_toughness()) + s.tax
            if cost <= m:
                s.pride = True; s.pride_sick = True; s.events.setdefault('pride', t); return m - cost
            return m
        mana = cast_pride(mana)
        mana = s.cast_stuff(mana)
        mana = cast_pride(mana)
        # Prowler's Helm equip
        if "Prowler's Helm" in s.perms and not any(c.get('helm') for c in s.bf) and mana >= 2:
            tgt = [c for c in s.bf if C[c['name']]['d'] and not C[c['name']]['mana']]
            if tgt:
                max(tgt, key=lambda c: min(s.tough(c), 7))['helm'] = True; mana -= 2
        # Pride activations on evasive targets
        amana = mana + s.abil_mana(); used = set()
        butt = s.butt()
        enablers = [(cost, n) for n, cost in ENABLERS.items() if s.in_play(n)]
        enablers.sort()
        if s.pride:
            while amana >= s.pride_cost() and s.alive():
                o = min(s.alive(), key=lambda o: (o.power(t), o.life))
                prop = 2 if o.a['propaganda'] else 0
                cands = [c for c in s.bf if id(c) not in used and s.can_attack(c)
                         and not (C[c['name']]['mana'] and not C[c['name']].get('notap'))
                         and len(s.lib) - s.tough(c)*(2 if 'archive' in s.perms else 1) >= 20
                         and s.tough(c) <= 9]
                if not cands: break
                ev = [c for c in cands if s.evasive(c, o, t)]
                pick = None; extra = 0
                if ev: pick = max(ev, key=lambda c: s.tough(c))
                elif enablers and amana >= s.pride_cost() + enablers[0][0] + prop:
                    cost, en = enablers.pop(0); extra = cost; pick = max(cands, key=lambda c: s.tough(c))
                if not pick or amana < s.pride_cost() + extra + prop: break
                amana -= s.pride_cost() + extra + prop; used.add(id(pick))
                dmg = s.tough(pick) if (butt or pick.get('umbra')) else s.power(pick)+1
                o.life -= dmg
                s.draw(s.tough(pick))
                if any(C[x['name']].get('ohran') for x in s.bf): s.draw(1)
                s.stats['pride_hits'] += 1
                if s.decked: return 'decked'
        if not s.alive(): s.why = 'damage'; return 'win'
        return None

    def cast_stuff(s, mana):
        def prio(n):
            i = C[n]
            if i.get('rock') or (i['kind']=='creature' and i['mana']): return (0, i['mv'])
            if i.get('reduce') or i.get('archive') or i.get('guardian'): return (1, i['mv'])
            if i['kind']=='creature': return (2, -(i['t']+(5 if i.get('crawler') else 0))/max(1,i['mv']))
            if i.get('perm') or n in ("Prowler's Helm",'Key to the City','Lightning Greaves'): return (3, i['mv'])
            return (9, i['mv'])
        # hold back protection mana: 1 for Saved by the Shell / Veil, 2 for Counterspell
        reserve = 0
        if 'Counterspell' in s.hand: reserve = 2
        elif 'Saved by the Shell' in s.hand or 'Miscast' in s.hand: reserve = 1
        progressed = True
        while progressed:
            progressed = False
            for n in sorted([h for h in s.hand if C[h]['kind']!='land'], key=prio):
                i = C[n]
                if n in ("Prowler's Helm",'Key to the City'):
                    if i['mv'] <= mana - reserve:
                        s.hand.remove(n); s.perms.add(n); mana -= i['mv']; progressed = True; break
                    continue
                if i.get('dead') or i.get('triumph') or i.get('tower') or i.get('regrowth'): continue
                if i['mv'] > mana - reserve: continue
                if i.get('draw'):
                    s.hand.remove(n); mana -= i['mv']; s.draw(i['draw']); s.gy.append(n); progressed = True; break
                s.hand.remove(n); mana -= i['mv']
                if i['kind']=='creature':
                    s.enter(n)
                    if i.get('regrow') and 'Triumph of the Hordes' in s.gy:
                        s.gy.remove('Triumph of the Hordes'); s.hand.append('Triumph of the Hordes')
                else:
                    if i.get('umbra') and s.bf:
                        max(s.bf, key=lambda c: s.tough(c))['umbra'] = True
                    else: s.perms.add(n)
                progressed = True; break
        # Regrowth on Triumph
        if 'Regrowth' in s.hand and 'Triumph of the Hordes' in s.gy and mana - reserve >= 2:
            s.hand.remove('Regrowth'); s.gy.remove('Triumph of the Hordes'); s.hand.append('Triumph of the Hordes'); mana -= 2
        return mana

    # ---- Triumph turn vs real blockers / counters / Aetherize / Propaganda ----
    def try_triumph_table(s, mana):
        t = s.turn
        if 'Triumph of the Hordes' not in s.hand: return None
        budget = mana - 4
        if budget < 0: return None
        bonus = 1; tower = False
        if 'Tower Defense' in s.hand and budget >= 2: bonus += 5; budget -= 2; tower = True
        veil = 'Veil of Summer' in s.hand and budget >= 1
        cspell = 'Counterspell' in s.hand and budget - (1 if veil else 0) >= 2
        butt = s.butt()
        att = []
        for c in s.bf:
            info = C[c['name']]
            if not s.can_attack(c): continue
            if info['mana'] and not info.get('notap'): continue
            tt = s.tough(c) + bonus; p = s.power(c) + 1
            if info['d']:
                opts = []
                if 'Assault Formation' in s.perms: opts.append((1, tt if butt else p))
                if s.has('Walking Bulwark'): opts.append((s.bulwark_cost(), tt))
                if s.pride: opts.append((s.pride_cost(), tt if butt else p))
                if not opts: continue
                cost, dmg = min(opts, key=lambda x: (x[0], -x[1]))
            else:
                cost, dmg = 0, (tt if (butt or c.get('umbra')) else p)
            att.append([cost, dmg, c])
        if s.pride and not s.pride_sick:
            att.append([0, (15+bonus) if butt else 3, {'name': 'The Pride of Hull Clade'}])
        att.sort(key=lambda a: -a[1])
        pool = budget + s.abil_mana() - (1 if veil else 0)
        # assign attackers to each opponent; each opp blocks with nblockers (trample: lose blocker_t each)
        plan = []; spent = 0; used = set()
        for o in sorted(s.alive(), key=lambda o: -(10 - o.poison)):
            need = 10 - o.poison; nb = o.nblockers(t); bt = o.a['blocker_t']
            prop = 2 if o.a['propaganda'] else 0
            got = []
            for a in att:
                if id(a[2]) in used: continue
                if a[0] + prop + spent > pool: continue
                unb = a[2]['name'] in UNBLOCKABLE or a[2].get('helm') or (
                    s.has('Tetsuko Umezawa, Fugitive') and a[2]['name'] != 'The Pride of Hull Clade' and s.power(a[2]) + 1 <= 1)
                eff = a[1] if unb else a[1] - (bt if len([g for g in got if not g[1]]) < nb else 0)
                if eff <= 0: continue
                used.add(id(a[2])); spent += a[0] + prop; got.append((a, unb)); need -= eff
                if need <= 0: break
            if need > 0: return None
            plan.append((o, got))
        # it's lethal on paper: now opponents respond
        keen = [o for o in s.alive() if o.hand['K'] > 0]
        s.hand.remove('Triumph of the Hordes')
        if tower: s.hand.remove('Tower Defense')
        if keen and not veil:
            o = keen[0]
            if s.rng.random() < 0.75:   # they have mana up
                if cspell and s.rng.random() < 0.8:
                    s.hand.remove('Counterspell'); s.stats['won_counter_war'] += 1
                else:
                    o.hand['K'] -= 1; s.gy.append('Triumph of the Hordes')
                    if tower: s.gy.append('Tower Defense')
                    s.stats['triumph_countered'] += 1; s._mana_after = max(0, mana - 4)
                    return None
        elif veil:
            s.hand.remove('Veil of Summer')
        aeth = [o for o in s.alive() if o.hand['A'] > 0]
        if aeth and s.rng.random() < 0.75:
            aeth[0].hand['A'] -= 1
            s.stats['aetherized'] += 1
            # all attackers return to hand; Triumph spent
            s.gy.append('Triumph of the Hordes')
            back = [c for c in s.bf if any(a[2] is c for _, got in plan for a, _u in got)]
            for c in back: s.bf.remove(c); s.hand.append(c['name'])
            if any(a[2]['name']=='The Pride of Hull Clade' for _, got in plan for a, _u in got):
                s.pride = False
            s._mana_after = 0
            return None
        for o, got in plan: o.poison = 10
        s.why = 'triumph'
        return 'win'

    # ---- opponents' turns ----
    def opp_turns(s):
        t = s.turn
        for o in list(s.opps):
            if not o.alive(): continue
            o.draw()
            o.acc += o.a['extra_draw']
            while o.acc >= 1: o.draw(); o.acc -= 1
            # board wipe?
            ncre = len(s.bf)
            if o.hand['W'] > 0 and o.wipes_left and (ncre >= 9 or (ncre >= 6 and s.rng.random() < 0.6)):
                o.hand['W'] -= 1; kind = o.wipes_left.pop()
                s.resolve_wipe(kind, o)
            # spot removal on biggest threat
            if o.hand['S'] > 0:
                p = 0.55 * (0.6 if s.has('Esior, Wardwing Familiar') else 1.0)
                if s.rng.random() < p: s.resolve_spot(o)
            # attacks
            if not s.alive_me(): return
            s.opp_attack(o)
            if s.life <= 0: return

    def alive_me(s): return s.life > 0

    def resolve_wipe(s, kind, o):
        # responses
        if 'Counterspell' in s.hand and s.rng.random() < 0.7:
            s.hand.remove('Counterspell'); s.stats['wipe_countered'] += 1; return
        if 'Miscast' in s.hand and s.rng.random() < 0.4:
            s.hand.remove('Miscast'); s.stats['wipe_countered'] += 1; return
        saved_by_hi = False
        if 'Heroic Intervention' in s.hand and kind not in ('all_is_dust',):
            s.hand.remove('Heroic Intervention'); s.stats['wipe_heroic'] += 1; saved_by_hi = True
        s.stats['wipes_taken'] += 1
        if saved_by_hi:
            if kind in ('destroy_creatures','disk','blasphemous','chain_reaction','magmaquake','predation'):
                return
        before = len(s.bf)
        if kind == 'destroy_creatures' or kind == 'disk':
            dead = list(s.bf)
            if kind == 'disk':
                for p in list(s.perms):
                    if p not in ('Training Grounds',) or True:
                        if C[p]['kind'] != 'land': s.perms.discard(p)
        elif kind == 'all_is_dust':
            dead = [c for c in s.bf if c['name'] not in ('Walking Bulwark','Shield Sphere','Psychosis Crawler','Crashing Drawbridge','Wall of Junk','Wall of Tanglecord','Excavated Wall','Suspicious Bookcase','The Reality Chip')]
            for p in list(s.perms):
                if p not in ('Sol Ring','Lightning Greaves',"Prowler's Helm",'Key to the City','The Enigma Jewel // Locus of Enlightenment',"Alhammarret's Archive"):
                    s.perms.discard(p)
        elif kind == 'blasphemous':
            if s.has('Ancient Adamantoise'):
                dead = [c for c in s.bf if c['name'] == 'Ancient Adamantoise']
            else: dead = [c for c in s.bf if s.tough(c) <= 13]
        elif kind == 'chain_reaction':
            x = len(s.bf) + 6
            dead = [c for c in s.bf if s.tough(c) <= x]
            if s.has('Ancient Adamantoise'): dead = [c for c in s.bf if c['name']=='Ancient Adamantoise'] if x*len(s.bf) >= 20 else []
        elif kind == 'magmaquake':
            x = 6
            dead = [c for c in s.bf if s.tough(c) <= x and c['name'] not in FLIERS]
            if s.has('Ancient Adamantoise'): dead = [c for c in s.bf if c['name']=='Ancient Adamantoise'] if x*len(s.bf) >= 20 else []
        elif kind == 'predation':
            dead = [c for c in s.bf if s.tough(c) <= 4]
        for c in dead:
            if c in s.bf: s.bf.remove(c)
        if kind in ('destroy_creatures','disk','blasphemous','chain_reaction'):
            if s.pride and kind != 'blasphemous' or (kind=='blasphemous' and not s.has('Ancient Adamantoise')):
                if s.pride: s.pride = False; s.tax += 2
        if kind == 'all_is_dust' and s.pride: s.pride = False; s.tax += 2
        if kind in ('destroy_creatures','disk','all_is_dust','chain_reaction','magmaquake'):
            o.pmult *= 0.35   # their own board suffers too
        s.stats['creatures_lost'] += before - len(s.bf)

    def resolve_spot(s, o):
        # pick target
        tgt = None
        if s.pride: tgt = 'PRIDE'
        else:
            pri = ['Psychosis Crawler','Walking Bulwark','Bedrock Tortoise','Tetsuko Umezawa, Fugitive']
            for n in pri:
                if s.has(n): tgt = next(c for c in s.bf if c['name']==n); break
        if tgt is None: return
        o.hand['S'] -= 1
        if 'Saved by the Shell' in s.hand:
            s.hand.remove('Saved by the Shell'); s.stats['saved_by_shell'] += 1; return
        if 'Counterspell' in s.hand and s.rng.random() < 0.5:
            s.hand.remove('Counterspell'); s.stats['removal_countered'] += 1; return
        if tgt == 'PRIDE':
            s.pride = False; s.tax += 2; s.stats['pride_removed'] += 1
        else:
            s.bf.remove(tgt); s.stats['piece_removed'] += 1

    def opp_attack(s, o):
        t = s.turn
        P = o.power(t) * 0.6
        if P <= 0: return
        others = [x for x in s.alive() if x is not o]
        n_targets = len(others) + 1
        share = 1.0 / n_targets
        # your relevant blockers
        if o.a['flying']:
            bl = [s.tough(c) for c in s.bf if c['name'] in FLIERS | REACH]
        else:
            bl = [s.tough(c) for c in s.bf if not (C[c['name']]['mana'] and not C[c['name']].get('notap'))]
        bl.sort(reverse=True)
        absorb = sum(bl[:4]) if o.a['trample'] else sum(min(b, 99) for b in bl[:4]) * 1.5
        to_me = P * share
        # if you're well defended, they send the damage elsewhere instead
        through = max(0.0, to_me - absorb)
        redirected = min(to_me, absorb) * 0.7
        s.life -= through
        if 'Ancient Adamantoise' in [c['name'] for c in s.bf] and through > 0:
            s.life += through  # Adamantoise soaks it
            ad = next(c for c in s.bf if c['name']=='Ancient Adamantoise')
            ad['dmg'] = ad.get('dmg', 0) + through
            if ad['dmg'] >= 20: s.bf.remove(ad)
        rest = P * (1 - share) + redirected
        if others:
            for x in others: x.life -= rest / len(others)

def table_game(deck_fn, seed, opp_names, maxturn=20):
    g = TableGame(deck_fn(), seed, opp_names)
    for _ in range(7): g.hand.append(g.lib.pop())
    out = None
    for _ in range(maxturn):
        out = g.play_turn()
        if out == 'win': return 'win', g.why, g.turn, g
        if out == 'decked': return 'loss', 'decked', g.turn, g
        g._mana_after = None
        if hasattr(g, '_mana_after'): del g._mana_after
        g.opp_turns()
        if g.life <= 0: return 'loss', 'killed', g.turn, g
        if not g.alive(): return 'win', 'outlasted', g.turn, g
    return 'loss', 'timeout', g.turn, g

def run(deck_fn, opp_names, n=2000):
    res = Counter(); turns = []; st = Counter()
    for seed in range(n):
        out, why, t, g = table_game(deck_fn, seed, opp_names)
        res[(out, why)] += 1
        if out == 'win': turns.append(t)
        st.update(g.stats)
    wins = sum(v for (o, _), v in res.items() if o == 'win')
    return dict(winrate=100*wins/n, median_win=statistics.median(turns) if turns else None,
                breakdown={f"{o}:{w}": round(100*v/n,1) for (o, w), v in sorted(res.items())},
                per_game={k: round(v/n, 2) for k, v in st.items()})

ALL = list(OPP)
if __name__ == '__main__':
    import itertools, json
    pods = {'Full mix (Dino + Angels + Thopters)': [ALL[0], ALL[1], ALL[2]],
            'Full mix (Angels + Thopters + Dragons)': [ALL[1], ALL[2], ALL[3]],
            'Dino + Dragons + Angels': [ALL[0], ALL[3], ALL[1]]}
    for name, fn in [('CURRENT', gf.original_deck), ('REVISED', gf.revised_deck)]:
        for pod, opps in pods.items():
            print(name, '|', pod, json.dumps(run(fn, opps)))
    # one-on-three versus each archetype (3 copies) to isolate matchups
    for name, fn in [('CURRENT', gf.original_deck), ('REVISED', gf.revised_deck)]:
        for o in ALL:
            r = run(fn, [o, o, o], n=1000)
            print(name, '| vs 3x', o, json.dumps(r))
