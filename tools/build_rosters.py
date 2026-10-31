#!/usr/bin/env python3
"""Builds data/teams.json, data/arenas.json and data/players.json.

    python3 tools/build_rosters.py                 # bundled 2025-26 opening-night rosters
    python3 tools/build_rosters.py --espn          # current rosters from ESPN's public API
    python3 tools/build_rosters.py --espn --logos  # ...and download team logos to data/logos/

The bundled rosters are a fallback typed from memory and go stale with every trade.
CI runs --espn --logos before each APK build so the phone always gets current rosters.
Logos are only downloaded at build time (data/logos/ is git-ignored), never committed.

Ratings: ESPN has no ratings, so overalls come from the OVERALL table below (keyed by
name). Players not in it get an estimate from years of experience. Per-attribute ratings
are derived from the overall and position. Phase 4 replaces this with stat-based ratings.
"""
import argparse
import hashlib
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# id, city, name, primary, secondary, accent, arena, espn abbreviation
TEAMS = [
    ("ATL", "Atlanta", "Hawks", "#E03A3E", "#C1D32F", "#FFFFFF", "State Farm Arena", "ATL"),
    ("BOS", "Boston", "Celtics", "#007A33", "#BA9653", "#FFFFFF", "TD Garden", "BOS"),
    ("BKN", "Brooklyn", "Nets", "#000000", "#FFFFFF", "#A1A1A4", "Barclays Center", "BKN"),
    ("CHA", "Charlotte", "Hornets", "#1D1160", "#00788C", "#A1A1A4", "Spectrum Center", "CHA"),
    ("CHI", "Chicago", "Bulls", "#CE1141", "#000000", "#FFFFFF", "United Center", "CHI"),
    ("CLE", "Cleveland", "Cavaliers", "#860038", "#FDBB30", "#041E42", "Rocket Arena", "CLE"),
    ("DAL", "Dallas", "Mavericks", "#00538C", "#B8C4CA", "#FFFFFF", "American Airlines Center", "DAL"),
    ("DEN", "Denver", "Nuggets", "#0E2240", "#FEC524", "#8B2131", "Ball Arena", "DEN"),
    ("DET", "Detroit", "Pistons", "#C8102E", "#1D42BA", "#FFFFFF", "Little Caesars Arena", "DET"),
    ("GSW", "Golden State", "Warriors", "#1D428A", "#FFC72C", "#FFFFFF", "Chase Center", "GS"),
    ("HOU", "Houston", "Rockets", "#CE1141", "#C4CED4", "#000000", "Toyota Center", "HOU"),
    ("IND", "Indiana", "Pacers", "#002D62", "#FDBB30", "#BEC0C2", "Gainbridge Fieldhouse", "IND"),
    ("LAC", "LA", "Clippers", "#C8102E", "#1D428A", "#FFFFFF", "Intuit Dome", "LAC"),
    ("LAL", "Los Angeles", "Lakers", "#552583", "#FDB927", "#FFFFFF", "Crypto.com Arena", "LAL"),
    ("MEM", "Memphis", "Grizzlies", "#5D76A9", "#12173F", "#F5B112", "FedExForum", "MEM"),
    ("MIA", "Miami", "Heat", "#98002E", "#F9A01B", "#000000", "Kaseya Center", "MIA"),
    ("MIL", "Milwaukee", "Bucks", "#00471B", "#EEE1C6", "#0077C0", "Fiserv Forum", "MIL"),
    ("MIN", "Minnesota", "Timberwolves", "#0C2340", "#236192", "#78BE20", "Target Center", "MIN"),
    ("NOP", "New Orleans", "Pelicans", "#0C2340", "#C8102E", "#85714D", "Smoothie King Center", "NO"),
    ("NYK", "New York", "Knicks", "#006BB6", "#F58426", "#BEC0C2", "Madison Square Garden", "NY"),
    ("OKC", "Oklahoma City", "Thunder", "#007AC1", "#EF3B24", "#FDBB30", "Paycom Center", "OKC"),
    ("ORL", "Orlando", "Magic", "#0077C0", "#C4CED4", "#000000", "Kia Center", "ORL"),
    ("PHI", "Philadelphia", "76ers", "#006BB6", "#ED174C", "#FFFFFF", "Xfinity Mobile Arena", "PHI"),
    ("PHX", "Phoenix", "Suns", "#1D1160", "#E56020", "#F9AD1B", "Mortgage Matchup Center", "PHX"),
    ("POR", "Portland", "Trail Blazers", "#E03A3E", "#000000", "#FFFFFF", "Moda Center", "POR"),
    ("SAC", "Sacramento", "Kings", "#5A2D81", "#63727A", "#FFFFFF", "Golden 1 Center", "SAC"),
    ("SAS", "San Antonio", "Spurs", "#000000", "#C4CED4", "#FFFFFF", "Frost Bank Center", "SA"),
    ("TOR", "Toronto", "Raptors", "#CE1141", "#000000", "#A1A1A4", "Scotiabank Arena", "TOR"),
    ("UTA", "Utah", "Jazz", "#4E2A84", "#000000", "#FFFFFF", "Delta Center", "UTAH"),
    ("WAS", "Washington", "Wizards", "#002B5C", "#E31837", "#C4CED4", "Capital One Arena", "WSH"),
]

# 2025-26 opening-night rosters (fallback). number|name|pos|height in inches|overall
ROSTERS = {
    "ATL": """11|Trae Young|PG|73|88
1|Jalen Johnson|SF|81|85
5|Dyson Daniels|SG|79|82
8|Kristaps Porzingis|C|87|82
17|Onyeka Okongwu|C|80|79
10|Zaccharie Risacher|SF|80|76
9|Nickeil Alexander-Walker|SG|77|77
3|Luke Kennard|SG|77|74
18|Mouhamed Gueye|PF|83|70""",
    "BOS": """0|Jayson Tatum|SF|80|93
7|Jaylen Brown|SG|78|88
9|Derrick White|SG|76|84
11|Payton Pritchard|PG|73|80
4|Anfernee Simons|SG|75|79
88|Neemias Queta|C|84|74
30|Sam Hauser|SF|79|75
8|Josh Minott|PF|80|70
28|Hugo Gonzalez|SF|78|68""",
    "BKN": """17|Michael Porter Jr.|SF|82|81
24|Cam Thomas|SG|75|78
33|Nic Claxton|C|83|77
21|Noah Clowney|PF|82|72
14|Terance Mann|SG|77|73
20|Day'Ron Sharpe|C|81|71
8|Egor Demin|PG|81|70
1|Ziaire Williams|SF|81|71""",
    "CHA": """1|LaMelo Ball|PG|79|85
24|Brandon Miller|SF|81|82
0|Miles Bridges|PF|79|79
7|Kon Knueppel|SG|79|76
4|Collin Sexton|PG|75|75
2|Grant Williams|PF|78|72
14|Moussa Diabate|C|82|71
8|Josh Green|SG|77|71
11|Ryan Kalkbrenner|C|85|69""",
    "CHI": """3|Josh Giddey|PG|80|81
0|Coby White|SG|76|81
9|Nikola Vucevic|C|82|80
14|Matas Buzelis|PF|82|76
44|Patrick Williams|PF|79|74
11|Ayo Dosunmu|SG|77|75
13|Kevin Huerter|SG|79|74
30|Tre Jones|PG|73|73
7|Jalen Smith|C|82|71""",
    "CLE": """45|Donovan Mitchell|SG|75|91
4|Evan Mobley|PF|84|88
10|Darius Garland|PG|73|85
31|Jarrett Allen|C|81|84
12|De'Andre Hunter|SF|80|78
1|Max Strus|SF|77|76
2|Lonzo Ball|PG|78|74
5|Sam Merrill|SG|76|73
32|Dean Wade|PF|81|71""",
    "DAL": """3|Anthony Davis|PF|82|89
11|Kyrie Irving|PG|74|87
32|Cooper Flagg|SF|81|80
31|Klay Thompson|SG|78|79
25|P.J. Washington|PF|79|78
2|Dereck Lively II|C|85|77
21|Daniel Gafford|C|82|77
5|D'Angelo Russell|PG|76|76
13|Naji Marshall|SF|79|75
0|Max Christie|SG|77|74""",
    "DEN": """15|Nikola Jokic|C|83|98
27|Jamal Murray|PG|76|87
32|Aaron Gordon|PF|80|82
23|Cameron Johnson|SF|80|80
0|Christian Braun|SG|78|79
17|Jonas Valanciunas|C|83|76
8|Peyton Watson|SF|80|74
11|Bruce Brown|SG|76|74
10|Tim Hardaway Jr.|SF|77|73""",
    "DET": """2|Cade Cunningham|PG|78|91
0|Jalen Duren|C|82|82
9|Ausar Thompson|SF|79|80
12|Tobias Harris|PF|80|78
23|Jaden Ivey|SG|76|78
28|Isaiah Stewart|C|80|76
55|Duncan Robinson|SF|79|75
8|Caris LeVert|SG|78|74
5|Ron Holland II|SF|79|72""",
    "GSW": """30|Stephen Curry|PG|74|93
10|Jimmy Butler III|SF|79|86
23|Draymond Green|PF|78|80
1|Jonathan Kuminga|PF|79|78
2|Brandin Podziemski|SG|76|77
7|Buddy Hield|SG|76|75
20|Al Horford|C|81|75
4|Moses Moody|SG|77|74
8|De'Anthony Melton|PG|74|74
0|Gary Payton II|SG|74|72""",
    "HOU": """7|Kevin Durant|SF|83|92
28|Alperen Sengun|C|83|88
1|Amen Thompson|SF|79|84
5|Fred VanVleet|PG|72|81
10|Jabari Smith Jr.|PF|83|80
17|Tari Eason|PF|80|78
12|Steven Adams|C|83|75
2|Dorian Finney-Smith|PF|79|74
15|Reed Sheppard|PG|74|74
30|Clint Capela|C|82|73""",
    "IND": """0|Tyrese Haliburton|PG|77|90
43|Pascal Siakam|PF|80|87
2|Andrew Nembhard|PG|77|79
00|Bennedict Mathurin|SG|78|78
23|Aaron Nesmith|SF|77|77
9|T.J. McConnell|PG|73|75
1|Obi Toppin|PF|81|74
32|Jay Huff|C|85|72
26|Ben Sheppard|SG|78|70""",
    "LAC": """2|Kawhi Leonard|SF|79|90
1|James Harden|PG|77|88
40|Ivica Zubac|C|84|84
0|Bradley Beal|SG|76|78
20|John Collins|PF|81|78
55|Derrick Jones Jr.|SF|78|75
11|Brook Lopez|C|85|75
3|Chris Paul|PG|72|75
8|Kris Dunn|PG|75|74
33|Nicolas Batum|SF|80|72""",
    "LAL": """77|Luka Doncic|PG|78|96
23|LeBron James|SF|81|89
15|Austin Reaves|SG|77|84
5|Deandre Ayton|C|84|79
28|Rui Hachimura|PF|80|78
36|Marcus Smart|SG|75|75
2|Jarred Vanderbilt|PF|80|72
11|Jaxson Hayes|C|84|72
4|Dalton Knecht|SF|78|70
7|Gabe Vincent|PG|75|70""",
    "MEM": """12|Ja Morant|PG|74|88
13|Jaren Jackson Jr.|PF|82|86
14|Zach Edey|C|88|79
0|Jaylen Wells|SF|79|76
7|Santi Aldama|PF|84|76
1|Kentavious Caldwell-Pope|SG|77|76
2|Ty Jerome|PG|77|75
5|Vince Williams Jr.|SF|76|73
23|Cedric Coward|SF|78|72
15|Brandon Clarke|PF|80|72""",
    "MIA": """13|Bam Adebayo|C|81|86
14|Tyler Herro|SG|77|84
24|Norman Powell|SG|75|81
22|Andrew Wiggins|SF|79|79
11|Jaime Jaquez Jr.|SF|78|77
7|Kel'el Ware|C|84|76
45|Davion Mitchell|PG|72|75
5|Nikola Jovic|PF|82|75
25|Kasparas Jakucionis|PG|78|68""",
    "MIL": """34|Giannis Antetokounmpo|PF|83|96
3|Myles Turner|C|83|82
18|Kyle Kuzma|PF|81|77
9|Bobby Portis|PF|82|77
7|Kevin Porter Jr.|PG|76|76
5|Gary Trent Jr.|SG|77|75
50|Cole Anthony|PG|75|73
13|Ryan Rollins|PG|76|72
20|AJ Green|SG|76|72
12|Taurean Prince|SF|79|72""",
    "MIN": """5|Anthony Edwards|SG|76|92
30|Julius Randle|PF|81|84
27|Rudy Gobert|C|85|83
3|Jaden McDaniels|SF|81|80
11|Naz Reid|C|81|80
0|Donte DiVincenzo|SG|76|78
10|Mike Conley|PG|73|75
4|Rob Dillingham|PG|73|70
1|Terrence Shannon Jr.|SG|78|70""",
    "NOP": """1|Zion Williamson|PF|78|86
25|Trey Murphy III|SF|80|82
5|Dejounte Murray|PG|76|80
2|Herbert Jones|SF|79|80
3|Jordan Poole|SG|76|77
22|Derik Queen|C|82|74
21|Yves Missi|C|83|74
0|Jeremiah Fears|PG|76|72
15|Jose Alvarado|PG|72|72
55|Kevon Looney|C|81|70""",
    "NYK": """11|Jalen Brunson|PG|74|92
32|Karl-Anthony Towns|C|84|89
8|OG Anunoby|SF|79|84
25|Mikal Bridges|SF|78|83
3|Josh Hart|SG|76|81
23|Mitchell Robinson|C|84|78
00|Jordan Clarkson|SG|76|76
2|Miles McBride|PG|74|75
28|Guerschon Yabusele|PF|80|73""",
    "OKC": """2|Shai Gilgeous-Alexander|PG|78|98
8|Jalen Williams|SF|78|88
7|Chet Holmgren|C|85|87
55|Isaiah Hartenstein|C|84|80
5|Luguentz Dort|SG|76|79
9|Alex Caruso|SG|77|78
22|Cason Wallace|PG|76|77
21|Aaron Wiggins|SG|77|74
11|Isaiah Joe|SG|76|74
25|Ajay Mitchell|PG|76|73""",
    "ORL": """5|Paolo Banchero|PF|82|89
22|Franz Wagner|SF|82|87
3|Desmond Bane|SG|77|84
4|Jalen Suggs|PG|76|81
34|Wendell Carter Jr.|C|82|78
1|Jonathan Isaac|PF|82|74
0|Anthony Black|PG|79|75
10|Tyus Jones|PG|72|74
35|Goga Bitadze|C|83|73
23|Tristan da Silva|SF|80|72""",
    "PHI": """21|Joel Embiid|C|84|90
0|Tyrese Maxey|PG|74|88
8|Paul George|SF|80|83
77|VJ Edgecombe|SG|77|76
9|Kelly Oubre Jr.|SF|79|77
5|Quentin Grimes|SG|77|77
20|Jared McCain|PG|74|74
1|Andre Drummond|C|83|72
7|Kyle Lowry|PG|72|70""",
    "PHX": """1|Devin Booker|SG|77|90
4|Jalen Green|SG|76|81
3|Dillon Brooks|SF|79|78
15|Mark Williams|C|84|77
8|Grayson Allen|SG|76|75
00|Royce O'Neale|SF|76|73
0|Ryan Dunn|SF|80|72
12|Collin Gillespie|PG|73|70
13|Oso Ighodaro|PF|83|68""",
    "POR": """8|Deni Avdija|SF|81|82
17|Shaedon Sharpe|SG|77|79
5|Jrue Holiday|PG|76|79
0|Damian Lillard|PG|74|80
9|Jerami Grant|PF|80|78
23|Donovan Clingan|C|86|78
33|Toumani Camara|PF|80|77
00|Scoot Henderson|PG|75|75
24|Kris Murray|PF|80|71
16|Yang Hansen|C|85|68""",
    "SAC": """11|Domantas Sabonis|C|82|86
8|Zach LaVine|SG|77|83
10|DeMar DeRozan|SF|78|82
0|Malik Monk|SG|75|79
13|Keegan Murray|PF|80|79
17|Dennis Schroder|PG|73|76
18|Russell Westbrook|PG|75|75
23|Keon Ellis|SG|75|73
5|Nique Clifford|SG|78|70""",
    "SAS": """1|Victor Wembanyama|C|88|93
4|De'Aaron Fox|PG|75|86
5|Stephon Castle|PG|78|80
24|Devin Vassell|SG|77|78
2|Dylan Harper|SG|78|76
40|Harrison Barnes|SF|80|75
3|Keldon Johnson|SF|77|75
10|Jeremy Sochan|PF|80|74
30|Julian Champagnie|SF|79|73
7|Luke Kornet|C|86|72""",
    "TOR": """4|Scottie Barnes|PF|80|86
3|Brandon Ingram|SF|80|84
9|RJ Barrett|SF|78|81
5|Immanuel Quickley|PG|75|79
19|Jakob Poeltl|C|85|79
1|Gradey Dick|SG|78|74
30|Ochai Agbaji|SG|77|72
23|Jamal Shead|PG|73|71
12|Collin Murray-Boyles|PF|79|70""",
    "UTA": """23|Lauri Markkanen|PF|84|85
24|Walker Kessler|C|84|79
3|Keyonte George|PG|76|78
19|Ace Bailey|SF|82|76
30|Jusuf Nurkic|C|83|74
13|Isaiah Collier|PG|75|72
42|Kevin Love|PF|80|72
0|Taylor Hendricks|PF|81|71
10|Svi Mykhailiuk|SG|79|70
5|Cody Williams|SF|80|69""",
    "WAS": """3|CJ McCollum|SG|75|80
22|Khris Middleton|SF|79|77
20|Alex Sarr|C|84|76
0|Bilal Coulibaly|SF|79|76
8|Bub Carrington|PG|76|73
24|Corey Kispert|SF|78|73
7|Cam Whitmore|SF|79|73
12|Tre Johnson|SG|77|72
18|Kyshawn George|SF|80|72
35|Marvin Bagley III|PF|83|72""",
}

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ATTRS = ["close_shot", "mid_range", "three_point", "free_throw", "layup", "dunk",
         "pass_accuracy", "ball_handle", "speed", "strength", "vertical", "stamina",
         "perimeter_d", "interior_d", "steal", "block", "off_reb", "def_reb"]
# How each position leans relative to its overall (added to overall, then jittered).
POS_BIAS = {
    "PG": {"three_point": 4, "ball_handle": 8, "pass_accuracy": 8, "speed": 6, "strength": -12,
           "interior_d": -14, "block": -16, "off_reb": -16, "def_reb": -12, "dunk": -8},
    "SG": {"three_point": 5, "mid_range": 3, "ball_handle": 3, "speed": 4, "strength": -8,
           "interior_d": -10, "block": -12, "off_reb": -12, "def_reb": -8},
    "SF": {"perimeter_d": 2, "dunk": 2, "block": -6, "off_reb": -6},
    "PF": {"strength": 4, "interior_d": 4, "off_reb": 3, "def_reb": 4, "ball_handle": -8,
           "pass_accuracy": -6, "speed": -4, "three_point": -4},
    "C": {"strength": 8, "interior_d": 8, "block": 8, "off_reb": 8, "def_reb": 9, "dunk": 4,
          "ball_handle": -16, "pass_accuracy": -10, "speed": -10, "three_point": -12, "mid_range": -6,
          "perimeter_d": -8, "steal": -8},
}


def stable_int(text: str, mod: int) -> int:
    return int(hashlib.md5(text.encode()).hexdigest(), 16) % mod


def ratings_for(name: str, pos: str, overall: int) -> dict:
    bias = POS_BIAS.get(pos, {})
    out = {}
    for a in ATTRS:
        jitter = stable_int(name + a, 13) - 6
        out[a] = max(25, min(99, overall + bias.get(a, 0) + jitter))
    return out


def norm_pos(pos: str, height: int) -> str:
    pos = (pos or "").upper()
    if pos in ("PG", "SG", "SF", "PF", "C"):
        return pos
    if pos == "G":
        return "PG" if height < 76 else "SG"
    if pos in ("G-F", "GF"):
        return "SG" if height < 79 else "SF"
    if pos == "F":
        return "SF" if height < 81 else "PF"
    if pos in ("F-C", "FC"):
        return "PF" if height < 83 else "C"
    if pos in ("C-F", "CF"):
        return "C"
    return "SF"


def player(team_id, number, name, pos, height, overall, weight=None, wingspan=None, espn_id=None):
    parts = name.split(" ", 1)
    first, last = (parts[0], parts[1]) if len(parts) == 2 else (name, "")
    p = {
        "id": f"{team_id}_{stable_int(name, 10**8):08d}",
        "team": team_id,
        "first": first, "last": last,
        "number": str(number),
        "pos": pos,
        "height_in": int(height),
        "weight_lb": int(weight or (150 + (height - 70) * 7)),
        "wingspan_in": int(wingspan or height + 3),
        "overall": int(overall),
        "starter": False,
        "ratings": ratings_for(name, pos, int(overall)),
    }
    if espn_id:
        p["espn_id"] = str(espn_id)
    return p


def pick_starters(players):
    """Best player at each position, then best remaining players to fill five."""
    ranked = sorted(players, key=lambda p: -p["overall"])
    starters, used = [], set()
    for pos in ("PG", "SG", "SF", "PF", "C"):
        for p in ranked:
            if p["pos"] == pos and p["id"] not in used and p["overall"] >= ranked[min(6, len(ranked) - 1)]["overall"]:
                starters.append(p)
                used.add(p["id"])
                break
    for p in ranked:
        if len(starters) >= 5:
            break
        if p["id"] not in used:
            starters.append(p)
            used.add(p["id"])
    for p in starters:
        p["starter"] = True


def overall_table():
    table = {}
    for lines in ROSTERS.values():
        for line in lines.splitlines():
            _, name, _, _, ovr = line.split("|")
            table[name.lower()] = int(ovr)
    return table


def fallback_players():
    out = []
    for team_id, lines in ROSTERS.items():
        team = []
        for line in lines.splitlines():
            num, name, pos, ht, ovr = line.split("|")
            team.append(player(team_id, num, name, pos, int(ht), int(ovr)))
        pick_starters(team)
        out.extend(team)
    return out


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Courtside roster tool)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def espn_players(logos: bool):
    overalls = overall_table()
    teams = fetch_json(f"{ESPN}/teams")["sports"][0]["leagues"][0]["teams"]
    by_abbr = {t["team"]["abbreviation"].upper(): t["team"] for t in teams}
    out = []
    for team_id, *_rest in TEAMS:
        espn_abbr = _rest[-1]
        t = by_abbr.get(espn_abbr) or by_abbr.get(team_id)
        if t is None:
            raise RuntimeError(f"ESPN has no team {espn_abbr}")
        data = fetch_json(f"{ESPN}/teams/{t['id']}/roster")
        athletes = data.get("athletes", [])
        if athletes and "items" in athletes[0]:          # grouped format
            athletes = [a for g in athletes for a in g["items"]]
        roster = []
        for a in athletes:
            name = a.get("fullName") or a.get("displayName")
            height = int(a.get("height") or 78)
            pos = norm_pos((a.get("position") or {}).get("abbreviation", ""), height)
            years = int((a.get("experience") or {}).get("years", 0) or 0)
            ovr = overalls.get(name.lower(), min(78, 66 + years))
            roster.append(player(team_id, a.get("jersey", "0"), name, pos, height, ovr,
                                 weight=a.get("weight"), espn_id=a.get("id")))
        if len(roster) < 5:
            raise RuntimeError(f"{team_id}: only {len(roster)} players from ESPN")
        pick_starters(roster)
        out.extend(roster)
        if logos:
            href = next((l["href"] for l in t.get("logos", []) if "default" in l.get("rel", [])),
                        (t.get("logos") or [{}])[0].get("href"))
            if href:
                (DATA / "logos").mkdir(exist_ok=True)
                req = urllib.request.Request(href, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    (DATA / "logos" / f"{team_id}.png").write_bytes(r.read())
        print(f"{team_id}: {len(roster)} players", file=sys.stderr)
    return out


def darken(hex_color: str, amount: float) -> str:
    rgb = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{int(c * (1.0 - amount)):02X}" for c in rgb)


def write(name, obj):
    (DATA / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--espn", action="store_true", help="fetch current rosters from ESPN")
    ap.add_argument("--logos", action="store_true", help="download team logos (needs --espn)")
    args = ap.parse_args()

    teams, arenas = [], []
    for tid, city, name, primary, secondary, accent, arena, _ in TEAMS:
        arena_id = tid.lower() + "_home"
        teams.append({"id": tid, "city": city, "name": name, "abbr": tid,
                      "primary": primary, "secondary": secondary, "accent": accent,
                      "arena": arena_id, "logo": "",
                      "court": {"paint": primary, "apron": darken(primary, 0.3), "stain": 0.0}})
        arenas.append({"id": arena_id, "name": arena, "seat_color": darken(primary, 0.35),
                       "ribbon_text": f"{arena.upper()}  •  {city.upper()} {name.upper()}",
                       "lower_rows": 18, "upper_rows": 22, "light_color": "#FFF6EA"})
    write("teams.json", {"_doc": "Generated by tools/build_rosters.py. A team logo is picked up "
                                 "automatically from data/logos/<id>.png (or user://data/logos/) when present.",
                         "teams": teams})
    write("arenas.json", {"_doc": "Generated by tools/build_rosters.py. Distances in feet.", "arenas": arenas})

    source = "2025-26 opening-night fallback"
    players = None
    if args.espn:
        try:
            players = espn_players(args.logos)
            source = "ESPN (fetched at build time)"
        except Exception as e:  # keep building with the fallback if ESPN is unreachable
            print(f"ESPN fetch failed, using fallback rosters: {e}", file=sys.stderr)
    if players is None:
        players = fallback_players()
    # Per-player looks live in data/appearance.json so roster refreshes keep them.
    looks_path = DATA / "appearance.json"
    looks = json.loads(looks_path.read_text()).get("players", {}) if looks_path.exists() else {}
    for p in players:
        extra = looks.get(f"{p['first']} {p['last']}")
        if extra:
            p.update(extra)
    write("players.json", {"_doc": f"Rosters: {source}. Generated by tools/build_rosters.py; "
                                   "heights/wingspans in inches.", "source": source, "players": players})
    print(f"wrote {len(teams)} teams, {len(players)} players ({source})")


if __name__ == "__main__":
    main()
