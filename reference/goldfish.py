import random, statistics, sys
from collections import Counter

# ---------- card database ----------
# fields: kind, mv, p, t, defender, mana(int or 'def' for per-defender), flags
C = {}
def cr(n, mv, p, t, d=False, mana=0, **f): C[n] = dict(kind='creature', mv=mv, p=p, t=t, d=d, mana=mana, **f)
def nc(n, mv, **f): C[n] = dict(kind='spell', mv=mv, **f)
def land(n, **f): C[n] = dict(kind='land', mv=0, **f)

# creatures (original list)
cr('Aegis Turtle',1,0,5)
cr('Ancient Adamantoise',7,8,20)
cr('Angler Turtle',6,5,7)
cr('Armored Scrapgorger',2,0,3,mana=1)
cr('Bedrock Tortoise',4,0,6,butt=True)
cr("Biomancer's Familiar",2,2,2,reduce=1)
cr('Cephalid Facetaker',3,1,4)
cr('Charix, the Raging Isle',6,0,17)
cr('Crashing Drawbridge',2,0,4,d=True,haste=True)
cr('Elusive Krasis',3,0,4)
cr('Esior, Wardwing Familiar',2,1,2)
cr('Excavated Wall',2,0,4,d=True)          # assumed stats
cr('Fecund Greenshell',5,4,6,greenshell=True)
cr('Final-Word Phantom',3,1,4)
cr('Geralf, Visionary Stitcher',3,1,4)
cr('Gilded Goose',1,0,2)
cr('Gray Harbor Merfolk',1,1,3)
cr('Horizon Chimera',4,3,2)
cr('Hover Barrier',3,0,6,d=True)
cr('Leafkin Druid',2,0,3,mana=1)
cr('Mistford River Turtle',4,1,5)          # assumed stats
cr('Ohran Frostfang',5,2,6,ohran=True)
cr('Ornithopter',0,0,2)
cr('Ornithopter of Paradise',2,0,2,mana=1)
cr('Overgrown Battlement',2,0,4,d=True,mana='def')
cr('Portcullis Vine',1,0,3,d=True)
cr('Psychosis Crawler',5,0,0,crawler=True)
cr('Riptide Turtle',2,0,5,d=True)
cr('Snapping Voidcraw',3,1,3,mana=2)
cr('Suspicious Bookcase',2,0,4,d=True)
cr('Sylvan Caryatid',2,0,3,d=True,mana=1)
cr('Tetsuko Umezawa, Fugitive',2,1,3)
cr('The Reality Chip',2,0,4)
cr('Trygon Predator',3,2,3)
cr('Walking Bulwark',1,0,3,d=True,bulwark=True)
cr('Wall of Blossoms',2,0,4,d=True,etb_draw=1)
cr('Wall of Junk',2,0,7,d=True)
cr('Wall of Roots',2,0,5,d=True,mana=1,notap=True)
cr('Wall of Tanglecord',2,0,6,d=True)
# creatures (revised additions)
cr('Shield Sphere',0,0,6,d=True)
cr('Tree of Redemption',4,0,13,d=True)
cr('Vine Trellis',2,0,4,d=True,mana=1)
cr('Wall of Frost',3,0,7,d=True)
cr('Drift of Phantasms',3,0,5,d=True)
cr('Axebane Guardian',3,0,3,d=True,mana='def')
cr('Mnemonic Wall',5,0,4,d=True,regrow=True)

# noncreature spells
for n,mv in [('An Offer You Can\'t Refuse',1),('Beast Within',3),('Counterspell',2),('Dispel',1),
             ('Fae Flight',2),('Energy Tap',1),('Ivory Tower',1),('Key to the City',2),('Lightning Greaves',2),
             ('Lost in the Maze',3),('Miscast',1),('Reality Shift',2),('Carpet of Flowers',1),
             ('Veil of Summer',1),('Heroic Intervention',2),('Prowler\'s Helm',2),('Saved by the Shell',1)]:
    nc(n,mv,dead=True)
nc('Assault Formation',2,perm=True,butt=True)
nc('Training Grounds',1,perm=True,reduce=2)
nc('Guardian Project',4,perm=True,guardian=True)
nc('Sol Ring',1,perm=True,rock=2)
nc('The Enigma Jewel // Locus of Enlightenment',1,perm=True,abil_mana=2)
nc('Utopia Sprawl',1,perm=True,rock=1)
nc('Wild Growth',1,perm=True,rock=1)
nc('Fertile Ground',2,perm=True,rock=1)
nc('Treefolk Umbra',3,perm=True,umbra=True)
nc('Triumph of the Hordes',4,triumph=True)
nc('Intrude on the Mind',4,draw=3)
nc('Tower Defense',2,tower=True)
nc('Regrowth',2,regrowth=True)
nc("Alhammarret's Archive",5,perm=True,archive=True)

LANDS = ['Access Tunnel','Command Tower','Dreamroot Cascade','Escape Tunnel','Exotic Orchard','Fabled Passage',
         'Flooded Grove','Hinterland Harbor','Reliquary Tower','Waterlogged Grove','Yavimaya Coast',
         "Karn's Bastion","Rogue's Passage",'Forest','Island']
for l in LANDS: land(l)

ORIGINAL_SINGLES = """Access Tunnel|Aegis Turtle|An Offer You Can't Refuse|Ancient Adamantoise|Angler Turtle|Armored Scrapgorger|Assault Formation|Beast Within|Bedrock Tortoise|Biomancer's Familiar|Carpet of Flowers|Cephalid Facetaker|Charix, the Raging Isle|Command Tower|Counterspell|Crashing Drawbridge|Dispel|Dreamroot Cascade|Elusive Krasis|Energy Tap|Escape Tunnel|Esior, Wardwing Familiar|Excavated Wall|Exotic Orchard|Fabled Passage|Fae Flight|Fecund Greenshell|Fertile Ground|Final-Word Phantom|Flooded Grove|Geralf, Visionary Stitcher|Gilded Goose|Gray Harbor Merfolk|Guardian Project|Hinterland Harbor|Horizon Chimera|Hover Barrier|Intrude on the Mind|Ivory Tower|Key to the City|Leafkin Druid|Lightning Greaves|Lost in the Maze|Miscast|Mistford River Turtle|Ohran Frostfang|Ornithopter|Ornithopter of Paradise|Overgrown Battlement|Portcullis Vine|Psychosis Crawler|Reality Shift|Reliquary Tower|Riptide Turtle|Snapping Voidcraw|Sol Ring|Suspicious Bookcase|Sylvan Caryatid|Tetsuko Umezawa, Fugitive|The Enigma Jewel // Locus of Enlightenment|The Reality Chip|Training Grounds|Treefolk Umbra|Triumph of the Hordes|Trygon Predator|Utopia Sprawl|Walking Bulwark|Wall of Blossoms|Wall of Junk|Wall of Roots|Wall of Tanglecord|Waterlogged Grove|Wild Growth|Yavimaya Coast""".split('|')

def original_deck():
    d = list(ORIGINAL_SINGLES) + ['Forest']*11 + ['Island']*14
    assert len(d) == 99, len(d)
    return d

SWAPS = [('Ornithopter','Shield Sphere'),('Gilded Goose','Tree of Redemption'),('Gray Harbor Merfolk','Vine Trellis'),
         ('Snapping Voidcraw','Wall of Frost'),('Fae Flight','Drift of Phantasms'),('Horizon Chimera','Axebane Guardian'),
         ('Angler Turtle','Tower Defense'),('Lost in the Maze','Regrowth'),('Carpet of Flowers','Mnemonic Wall'),
         ('Dispel','Veil of Summer'),('Forest','Heroic Intervention'),('Forest',"Karn's Bastion"),
         ('Intrude on the Mind',"Prowler's Helm"),('Energy Tap','Saved by the Shell'),('Ivory Tower',"Alhammarret's Archive"),
         ('Island',"Rogue's Passage")]
def revised_deck():
    d = original_deck()
    for out, inn in SWAPS:
        d.remove(out); d.append(inn)
    assert len(d) == 99
    return d

for n in set(original_deck()) | set(revised_deck()):
    assert n in C, n

# ---------- game ----------
class Game:
    def __init__(s, deck, seed, log=False):
        s.rng = random.Random(seed)
        s.lib = deck[:]; s.rng.shuffle(s.lib)
        s.hand = []; s.bf = []   # bf: list of dicts {name, sick, umbra}
        s.lands = 0; s.perms = set(); s.gy = []
        s.pride = False; s.pride_sick = True
        s.opp = [{'life':40,'poison':0} for _ in range(3)]
        s.drawn_total = 0; s.turn = 0; s.decked = False
        s.log = log; s.lines = []
        s.first_draw_done = False
        s.events = {}
    def L(s, msg):
        if s.log: s.lines.append(f"T{s.turn}: {msg}")
    def alive(s): return [o for o in s.opp if o['life']>0 and o['poison']<10]
    def creatures(s): return s.bf
    def tough(s, c):
        if C[c['name']].get('crawler'): base = len(s.hand)
        else: base = C[c['name']]['t']
        if c.get('umbra'): base += 2
        if s.lands >= 10 and any(C[x['name']].get('greenshell') for x in s.bf): base += 2
        return base
    def power(s, c):
        p = len(s.hand) if C[c['name']].get('crawler') else C[c['name']]['p']
        if s.lands >= 10 and any(C[x['name']].get('greenshell') for x in s.bf): p += 2
        return p
    def total_toughness(s): return sum(s.tough(c) for c in s.bf)
    def ndef(s): return sum(1 for c in s.bf if C[c['name']]['d'])
    def draw(s, n, step=False):
        mult = 2 if 'archive' in s.perms else 1
        k = 0
        for i in range(n):
            amt = 1 if (step and i == 0) else mult
            for _ in range(amt):
                if not s.lib: s.decked = True; return k
                s.hand.append(s.lib.pop()); k += 1
        s.drawn_total += k
        if any(C[c['name']].get('crawler') for c in s.bf):
            for o in s.alive(): o['life'] -= k
        return k
    def reduction(s):
        r = 0
        if 'Training Grounds' in s.perms: r += 2
        if any(C[c['name']].get('reduce') for c in s.bf): r += 1
        return r
    def pride_cost(s): return 2 + max(0, 2 - s.reduction())
    def bulwark_cost(s): return max(1, 2 - s.reduction())
    def can_attack(s, c):
        if not c['sick']: return True
        return any(C[x['name']].get('haste') and not x['sick'] for x in s.bf)
    def mana_available(s):
        m = s.lands
        for p in s.perms:
            m += C[p].get('rock', 0)
        for c in s.bf:
            mm = C[c['name']]['mana']
            if c['sick'] and not C[c['name']].get('notap'): continue
            if mm == 'def': m += s.ndef()
            else: m += mm
        return m
    def abil_mana(s): return 2 if 'The Enigma Jewel // Locus of Enlightenment' in s.perms else 0
    def butt(s):
        return any(C[c['name']].get('butt') for c in s.bf) or 'Assault Formation' in s.perms
    def enter(s, name):
        c = {'name': name, 'sick': True}
        s.bf.append(c)
        info = C[name]
        if info.get('etb_draw'): s.draw(info['etb_draw'])
        if 'Guardian Project' in s.perms: s.draw(1)
        if any(C[x['name']].get('greenshell') for x in s.bf) and s.tough(c) > s.power(c) and s.lib:
            top = s.lib.pop()
            if C[top]['kind'] == 'land': s.lands += 1
            else: s.hand.append(top)
        return c

    # --- lethal check with Triumph ---
    def try_triumph(s, mana):
        if 'Triumph of the Hordes' not in s.hand: return False
        tower = 'Tower Defense' in s.hand
        budget = mana - 4
        if budget < 0: return False
        bonus_t = 1; use_tower = False
        if tower and budget >= 2: bonus_t += 5; budget -= 2; use_tower = True
        butt = s.butt()
        att = []
        for c in s.bf:
            info = C[c['name']]
            if not s.can_attack(c): continue
            if info['mana'] and not info.get('notap'): continue  # keep mana dorks home
            t = s.tough(c) + bonus_t; p = s.power(c) + 1
            if info['d']:
                opts = []
                if 'Assault Formation' in s.perms: opts.append((1, t if butt else p))
                if any(C[x['name']].get('bulwark') for x in s.bf): opts.append((s.bulwark_cost(), t))
                if s.pride: opts.append((s.pride_cost(), t if butt else p))
                if not opts: continue
                cost, dmg = min(opts, key=lambda x: (x[0], -x[1]))
            else:
                cost, dmg = 0, (t if (butt or c.get('umbra')) else p)
            att.append([cost, dmg])
        if s.pride and not s.pride_sick:
            att.append([0, (15+bonus_t) if butt else 3])
        needs = sorted([10 - o['poison'] for o in s.alive()], reverse=True)
        att.sort(key=lambda x: -x[1])
        spent = 0
        for i, need in enumerate(needs):
            while need > 0:
                cand = [a for a in att if a[0] + spent <= budget + s.abil_mana()]
                if not cand: return False
                a = cand[0]; att.remove(a); spent += a[0]; need -= a[1]
        s.L(f"WIN — Triumph of the Hordes{' + Tower Defense' if use_tower else ''}, infect alpha strike")
        return True

    def play_turn(s):
        s.turn += 1
        for c in s.bf: c['sick'] = False
        s.pride_sick = False if s.pride else True
        if s.turn > 1 or True:
            s.draw(1, step=True)
        if s.decked: return 'decked'
        # land
        for c in list(s.hand):
            if C[c]['kind'] == 'land':
                s.hand.remove(c); s.lands += 1; break
        mana = s.mana_available()
        if s.try_triumph(mana): return 'win_triumph'
        # cast commander
        if not s.pride:
            cost = max(1, 11 - s.total_toughness())
            if cost <= mana:
                mana -= cost; s.pride = True; s.pride_sick = True
                s.events.setdefault('pride', s.turn); s.L(f"cast The Pride of Hull Clade for {cost}")
        # cast permanents: ramp first, then by toughness/mv
        def prio(n):
            i = C[n]
            if i.get('rock') or (i['kind']=='creature' and i['mana']): return (0, i['mv'])
            if i.get('reduce') or i.get('archive') or i.get('guardian'): return (1, i['mv'])
            if i['kind']=='creature': return (2, -(i['t']+(5 if i.get('crawler') else 0))/max(1,i['mv']))
            if i.get('perm'): return (3, i['mv'])
            return (9, i['mv'])
        progressed = True
        while progressed:
            progressed = False
            for n in sorted([h for h in s.hand if C[h]['kind']!='land'], key=prio):
                i = C[n]
                if i.get('dead') or i.get('triumph') or i.get('tower'): continue
                if i['mv'] > mana: continue
                if i.get('regrowth') or i.get('regrow'):
                    pass
                if i.get('draw'):
                    s.hand.remove(n); mana -= i['mv']; s.draw(i['draw']); s.gy.append(n); progressed=True; break
                if i.get('regrowth'):
                    continue
                s.hand.remove(n); mana -= i['mv']
                if i['kind']=='creature':
                    c = s.enter(n)
                    if i.get('regrow') and 'Triumph of the Hordes' in s.gy:
                        s.gy.remove('Triumph of the Hordes'); s.hand.append('Triumph of the Hordes')
                    if C[n]['mana'] and C[n].get('notap'): mana += 0
                else:
                    if i.get('umbra') and s.bf:
                        tgt = max(s.bf, key=lambda c: s.tough(c)); tgt['umbra']=True
                    else:
                        s.perms.add(n)
                progressed = True; break
            if s.decked: return 'decked'
        if not s.pride:
            cost = max(1, 11 - s.total_toughness())
            if cost <= mana:
                mana -= cost; s.pride = True; s.pride_sick = True
                s.events.setdefault('pride', s.turn); s.L(f"cast The Pride of Hull Clade for {cost}")
        # Pride activations for draws (goldfish: unblocked)
        amana = mana + s.abil_mana()
        used = set()
        butt = s.butt()
        if s.pride:
            while amana >= s.pride_cost():
                cands = [c for c in s.bf if id(c) not in used and s.can_attack(c)
                         and not (C[c['name']]['mana'] and not C[c['name']].get('notap'))]
                safe = [c for c in cands if len(s.lib) - s.tough(c)*(2 if 'archive' in s.perms else 1) >= 20]
                if not safe: break
                c = max(safe, key=lambda c: s.tough(c))
                amana -= s.pride_cost(); used.add(id(c))
                dmg = s.tough(c) if (butt or c.get('umbra')) else s.power(c)+1
                tgt = min(s.alive(), key=lambda o: o['life']) if s.alive() else None
                if tgt: tgt['life'] -= dmg
                n = s.draw(s.tough(c))
                extra = 1 if any(C[x['name']].get('ohran') for x in s.bf) else 0
                if extra: s.draw(1)
                s.L(f"Pride ability on {c['name']} (T{s.tough(c)}): hit for {dmg}, drew {n}")
                if s.decked: return 'decked'
        # other attacks (nondefenders, goldfish no blockers)
        for c in s.bf:
            if id(c) in used or not s.can_attack(c) or C[c['name']]['d']: continue
            if C[c['name']]['mana'] and not C[c['name']].get('notap'): continue
            dmg = s.tough(c) if (butt or c.get('umbra')) else s.power(c)
            if dmg <= 0 or not s.alive(): continue
            tgt = min(s.alive(), key=lambda o: o['life']); tgt['life'] -= dmg
        # bulwark-enabled defenders for damage
        if any(C[x['name']].get('bulwark') for x in s.bf):
            for c in sorted(s.bf, key=lambda c: -s.tough(c)):
                if id(c) in used or not C[c['name']]['d'] or not s.can_attack(c): continue
                if C[c['name']]['mana'] and not C[c['name']].get('notap'): continue
                if amana < s.bulwark_cost() or not s.alive(): break
                amana -= s.bulwark_cost(); used.add(id(c))
                tgt = min(s.alive(), key=lambda o: o['life']); tgt['life'] -= s.tough(c)
        if not s.alive(): s.L("WIN — damage/ping"); return 'win_damage'
        return None

def run(deck_fn, n=3000, maxturn=20):
    res = Counter(); win_turns = []; pride_turns = []; drawn8 = []
    for seed in range(n):
        g = Game(deck_fn(), seed)
        for _ in range(7): g.hand.append(g.lib.pop())
        out = None
        for t in range(maxturn):
            out = g.play_turn()
            if g.turn == 8: drawn8.append(g.drawn_total)
            if out: break
        res[out or 'no_win'] += 1
        if out and out.startswith('win'): win_turns.append(g.turn)
        if 'pride' in g.events: pride_turns.append(g.events['pride'])
    def pct(k): return 100*sum(1 for t in win_turns if t<=k)/n
    return dict(results=res, median_win=statistics.median(win_turns) if win_turns else None,
                win_by_8=pct(8), win_by_10=pct(10), win_by_12=pct(12), win_by_15=pct(15),
                pride_median=statistics.median(pride_turns), pride_by4=100*sum(1 for t in pride_turns if t<=4)/n,
                avg_drawn_by8=statistics.mean(drawn8) if drawn8 else 0)

def sample(deck_fn, seed):
    g = Game(deck_fn(), seed, log=True)
    for _ in range(7): g.hand.append(g.lib.pop())
    g.lines.append("Opening hand: " + ", ".join(g.hand))
    for t in range(20):
        out = g.play_turn()
        if out: g.lines.append(f"Result: {out} on turn {g.turn}"); break
    return g.lines

if __name__ == '__main__':
    for name, fn in [('ORIGINAL', original_deck), ('REVISED', revised_deck)]:
        r = run(fn)
        print(name, r)
