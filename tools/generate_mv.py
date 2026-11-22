#!/usr/bin/env python3
"""Generate 孤夜's per-song MV clips (keyframe -> Gemini Omni clip -> web encode -> tracking).

Usage:
    GEMINI_API_KEY=... python3 tools/generate_mv.py keyframes [song_id ...]
    GEMINI_API_KEY=... python3 tools/generate_mv.py clips     [song_id ...]
    python3 tools/generate_mv.py encode                       [song_id ...]   (ffmpeg, free)
    GEMINI_API_KEY=... python3 tools/generate_mv.py track     [song_id ...]
    python3 tools/generate_mv.py manifest
    ... python3 tools/generate_mv.py all [song_id ...]

Every step skips outputs that already exist; delete a file to redo it (e.g. a rejected keyframe).
Work files go to tools/mv_work/ (not deployed); finished clips + manifest to assets/guye/mv/.
Each song gets SHOTS regular clips (played in turn while the MV stage is on) and one FEVER clip
(jumped to when FEVER starts; its burst happens around FEVER_AT seconds).
Look: 3D toon-shaded CG (like a 3D anime game cutscene); tools/mv_refs/guye_3d_sheet.jpg is her 3D
model sheet and robot_black/white.jpg are the real 3D renders of her robots 黑白無常.
Cost: about $0.07 per keyframe and $0.50 per clip.
"""
import base64
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
WORK = os.path.join(ROOT, "tools", "mv_work")
REFS = os.path.join(ROOT, "tools", "mv_refs")
OUT = os.path.join(ROOT, "assets", "guye", "mv")
BASE = "https://generativelanguage.googleapis.com/v1beta"
IMAGE_MODEL = os.environ.get("MV_IMAGE_MODEL", "gemini-3.1-flash-image")
CLIP_MODEL = os.environ.get("MV_CLIP_MODEL", "gemini-omni-1.2-flash")
TRACK_MODEL = os.environ.get("MV_TRACK_MODEL", "gemini-3.5-flash")
CLIP_SEC = 6.0
FEVER_AT = 0.8

GIRL = ("孤夜: anime girl with chin-length silver-white hair fading to cyan at the tips, black horn-shaped "
        "headphones, magenta eyes, off-shoulder pink and navy kimono-style outfit with cherry-blossom prints, "
        "long pink ribbons, white socks and black platform sandals; her instrument is an electric shamisen")
SHAMISEN = ("her instrument is a futuristic ELECTRIC SHAMISEN (Japanese three-string lute), NOT a pipa, NOT a "
            "guitar: a long thin straight neck with EXACTLY THREE strings, a headstock with EXACTLY THREE blue "
            "cylindrical tuning pegs sticking out sideways, a pink ring hanging near the top of the neck, and an "
            "angular faceted magenta body (not round, not pear-shaped) with cyan circuit lines, a cyan zigzag and a "
            "round disc emblem; she plays it with a blue paddle-shaped bachi plectrum, never with bare fingers")
ROBOTS = ("her two flying robots: the BLACK robot (dark charcoal shell) and the WHITE robot (pearl-white shell); "
          "both are round helmet-like bodies with two pink and lilac rabbit-ear fins, a glowing magenta ring lens, "
          "pink-rimmed headphone discs on the sides and two small spikes underneath. The robots are NOT humanoid: "
          "no arms, no legs, no hands, no face, no eyes other than the single ring lens; just flying round helmets")

# setting + colour palette per song, then three regular shots and the FEVER shot
SONGS = {
    "neon-drift": dict(bpm=90, mood="relaxed, dreamy synthwave",
        place="a retro 1980s synthwave world at dusk: a glowing magenta wireframe grid floor stretching to the horizon, "
              "a huge striped pink and orange sunset sun, purple sky, palm tree silhouettes, chrome highway"),
    "fiesta-caliente": dict(bpm=92, mood="hot, playful Latin reggaeton party",
        place="a warm tropical night street festival: colourful papel picado banners and string lights overhead, "
              "palm trees, pastel colonial houses, orange and magenta lanterns, confetti"),
    "sunset-boulevard": dict(bpm=105, mood="breezy, nostalgic 1980s Japanese city pop",
        place="a Tokyo rooftop at golden-hour sunset, pastel pink and peach sky, glittering bay and skyline, "
              "a vintage neon sign frame without readable letters, soft lens flares"),
    "groove-machine": dict(bpm=112, mood="funky 1970s disco",
        place="a retro disco club: a giant spinning mirror ball scattering light spots, a light-up dance floor of "
              "glowing coloured tiles, velvet curtains, purple and gold lights"),
    "skyline-run": dict(bpm=118, mood="bright, uplifting nu-disco",
        place="the top of a skyscraper at night high above a glittering city, a helipad ring of lights, "
              "searchlights sweeping the sky, cyan and green city glow, stars"),
    "starlight-stage": dict(bpm=125, mood="glamorous K-pop dance concert",
        place="a huge concert arena main stage, giant LED screens with abstract star patterns, a sea of pink "
              "light sticks in the crowd, white and pink spotlights, sparkling stage floor"),
    "voltage-rush": dict(bpm=144, mood="explosive electro house festival",
        place="an EDM festival main stage at night, massive speaker towers, green and yellow lasers slicing through "
              "smoke, pyrotechnic flames, electric lightning arcs"),
    "pixel-quest": dict(bpm=150, mood="heroic 8-bit video game adventure",
        place="an original retro 8-bit fantasy world drawn around her: floating pixel-art crystal islands, a distant "
              "pixel tower of purple stone, pixel stars and hearts, chunky pixel clouds in a bright turquoise sky "
              "(only the background is pixel art; no question-mark blocks, no coins, no mushrooms, no pipes)"),
    "neon-riot": dict(bpm=160, mood="wild pop-punk / J-rock live",
        place="a packed rock live house stage, stacks of plain black unbranded guitar amps, thick smoke, red and hot-pink spotlights, "
              "crowd hands in silhouette at the stage edge"),
    "hyper-circuit": dict(bpm=175, mood="intense high-speed drum and bass",
        place="a futuristic cyber tunnel of glowing red and cyan circuit lines rushing past at high speed, "
              "streams of data light, hexagon panels, motion streaks"),
    "fur-elise": dict(bpm=156, mood="elegant classical piano (Beethoven's Für Elise)",
        place="a moonlit gothic concert hall: tall arched windows with a full moon, a black grand piano, candle "
              "chandeliers, marble floor, drifting cherry blossom petals, deep blue and rose tones"),
}

SHOTS = ["1", "2", "3", "fever"]

# Per-song storyboard: (kind, keyframe composition, what happens in the clip) for shots 1, 2, 3 and FEVER.
# kind: "play" (she plays the shamisen; at most one per song), "dance", "story" (a little scene, instrument
# on her back), "close" (close-up detail) or "robots" (黑白無常 alone, she is not in the shot).
# Every song mixes different kinds so the MVs aren't all "girl strumming in front of a backdrop".
# Shot 1 always shows her and both robots clearly (it is the design reference for the song's other shots).
STORYBOARD = {
    "neon-drift": [
        ("story", "Medium side tracking shot: she drives an original open-top wedge-shaped retro-futuristic sports car "
         "(invented design, no badges, no logos, no lettering) along the neon grid highway at dusk, one hand on the "
         "wheel, hair and ribbons streaming in the wind, the shamisen lying on the back seat; the white robot sits "
         "in the passenger seat, the black robot rides on the front of the hood like a mascot.",
         "The camera tracks alongside the car. She glances at the camera and grins, then points ahead at the sun; "
         "the robots wobble in the wind; palm silhouettes and grid lines rush past."),
        ("robots", "No girl in this shot. The black robot and the white robot race each other low over the glowing "
         "magenta grid highway toward the huge striped sunset sun, leaving long pink and cyan light trails behind them.",
         "The camera chases them. The two robots weave around each other and take turns overtaking, playful; "
         "their light trails twist together; the sun shimmers ahead."),
        ("close", "Extreme close-up of her eyes and the top of her face, the striped sunset sun and neon grid "
         "reflected in her magenta eyes, her horned headphones glowing, silver hair drifting across her face.",
         "Very slow push-in. She slowly opens her eyes and a small smile appears; a warm lens flare passes; strands "
         "of hair drift in the breeze."),
        ("play", "High aerial view: she stands at the vanishing point of the glowing grid highway playing the "
         "electric shamisen with the bachi, waves of pink light rippling outward from her feet across the grid; the "
         "two robots circle her trailing neon light rings.",
         "Within the first second the whole grid flashes and rings of pink light ripple outward from her as she "
         "strikes the strings with the bachi; the camera swoops down toward her; the robots spiral around her."),
    ],
    "fiesta-caliente": [
        ("dance", "Wide street-level shot: she dances reggaeton in the middle of the festival street among "
         "silhouetted partygoers, hips swaying, both hands clapping above her head, the shamisen slung on her back; "
         "the two robots hover above her showering confetti.",
         "Camera tracks backward as she dances toward it through the crowd to the dembow beat, swinging her hips "
         "and clapping; confetti rains down; the robots spin and spray more confetti."),
        ("play", "She sits on a colourful painted stone staircase between pastel houses playing the electric "
         "shamisen with the bachi, tapping one foot; the black and white robots float above her holding a string of "
         "glowing lanterns between them.",
         "Slow orbit around her. She plays a playful riff with the bachi and taps her foot; the lantern string sways "
         "between the robots; little lights flutter around the lanterns."),
        ("robots", "No girl in this shot. Close on the black robot and the white robot hovering under the papel "
         "picado banners above a wooden table piled with tropical fruit (no signs, no stall, no boards), each balancing a pair of colourful "
         "maracas on top of its round head.",
         "The two robots bounce up and down on the beat, shaking the maracas off their heads and catching them "
         "again, then bump into each other and spin; banners flutter; string lights twinkle."),
        ("story", "She rides on top of a colourful flower-covered parade float rolling down the street, throwing "
         "handfuls of confetti to the crowd, fireworks bursting in pink and orange overhead; the shamisen on her "
         "back; the two robots launch the fireworks from either side of the float.",
         "Within the first second fireworks explode overhead and confetti bursts; she throws her arms wide and "
         "laughs as the float rolls on; the camera pulls back to reveal the whole festive street."),
    ],
    "sunset-boulevard": [
        ("story", "Medium shot: she leans on the rooftop railing at golden hour sipping a cream soda through a "
         "straw from a plain unlabelled glass, the shamisen leaning against the railing beside her; the black "
         "robot balances a spinning vinyl record on top of its head, the white robot glows softly next to her.",
         "Slow lateral dolly. She sips, then laughs at the black robot as the vinyl record keeps spinning on its "
         "head; her hair blows in the breeze; the city glitters below."),
        ("close", "Close-up side profile: eyes closed, she presses one hand to her horned headphones, lost in the "
         "music, framed against the huge setting sun, city lights as soft bokeh behind.",
         "Very slow push-in. She nods gently to the beat with her eyes closed and smiles; a lens flare passes; a "
         "cherry petal drifts across the frame."),
        ("play", "Back three-quarter view: she sits on the rooftop ledge with her legs dangling over the glittering "
         "bay city, playing the electric shamisen on her lap with the bachi; the black and white robots sit beside "
         "her on the ledge like little companions.",
         "Slow crane move up and around her. She plays a mellow riff with the bachi and tilts her head; the city "
         "lights begin to twinkle; the robots sway side to side with her."),
        ("dance", "Dusk turns to night: every neon sign and window on the surrounding buildings lights up in pink "
         "and cyan; she spins in a joyful city-pop dance with her arms out, kimono sleeves and ribbons flaring, the "
         "shamisen on her back; the two robots shoot light beams into the sky.",
         "Within the first second the whole city's neon flashes on; she spins and strikes a cute pose; the camera "
         "whips around her; streaks of light shoot up from the robots."),
    ],
    "groove-machine": [
        ("dance", "Wide shot on the light-up dance floor: she strikes a classic disco pose, one arm pointing up, "
         "hip out, the shamisen slung on her back; the black and white robots on either side tilt the same way, "
         "copying her pose.",
         "Camera rises slowly; the floor tiles change colour on every beat; she does a groovy disco dance, "
         "pointing up and down; the robots bob perfectly in sync with her."),
        ("robots", "No girl in this shot. The black robot and the white robot alone in the middle of the glowing "
         "dance floor under the giant mirror ball, spinning like little mirror balls themselves and scattering "
         "light spots everywhere.",
         "The two robots do a disco duet: they circle each other, spin, dip and bob in sync; the tiles below them "
         "light up in colour wherever they pass; the mirror ball turns overhead."),
        ("close", "Medium close-up of her face directly under the giant mirror ball, hundreds of little light "
         "spots dotting her face, hair and headphones; she looks over her shoulder at the camera.",
         "The mirror ball rotates and light spots sweep across her; she winks and blows a kiss to the camera; "
         "focus pulls from the ball to her."),
        ("play", "Low side view: she slides across the dance floor on her knees playing a guitar-style solo on the "
         "electric shamisen with the bachi, leaning back, as confetti cannons fire gold glitter; the two robots spin "
         "like mini mirror balls above her.",
         "Within the first second the confetti cannons blast gold glitter; she finishes the knee slide and keeps "
         "striking the strings with the bachi; light spots swirl; fast push-in."),
    ],
    "skyline-run": [
        ("story", "Side view: she leaps across the gap between two skyscraper rooftops at night, the shamisen on "
         "her back, the city far below; the black and white robots fly alongside her.",
         "Camera tracks sideways with her in slow motion mid-leap; she lands on the next rooftop and keeps "
         "running; the robots zoom alongside leaving light trails."),
        ("play", "Seen from behind: she stands at the very edge of the helipad playing the electric shamisen with "
         "the bachi, overlooking the vast glowing city; searchlights cross the sky; the two robots float ahead of "
         "her over the drop.",
         "Slow drone shot pulling back and rising, revealing the huge city around her; searchlights sweep."),
        ("robots", "No girl in this shot. The black robot and the white robot dive between glass skyscrapers at "
         "night, their reflections sliding across the mirrored windows, chasing a sweeping searchlight beam.",
         "Smooth gliding camera. The two round robots float and weave playfully around each other between the "
         "towers, drifting into the searchlight beam, which makes their shells gleam; reflections slide across the glass."),
        ("story", "She stands on top of the two robots like a hoverboard (one foot on each), arms spread wide, as "
         "they rocket upward past the skyscraper, the shamisen on her back, a burst of light below them.",
         "Within the first second a burst of light; the robots rocket upward carrying her; she whoops with her "
         "arms wide; the camera follows upward past glowing windows into the starry sky."),
    ],
    "starlight-stage": [
        ("story", "She rises from below the stage on a lift platform in a column of white light and smoke, the "
         "shamisen on her back, one hand raised to the crowd; the two robots descend from above to meet her.",
         "The lift rises and she emerges from the smoke into the light, waving; the robots settle at her sides; "
         "pink light sticks wave in the dark arena."),
        ("dance", "Wide shot of the stage: she performs a sharp K-pop dance routine, mid-move with one arm "
         "snapping out, the shamisen on her back; the black and white robots move in sync as her backup dancers "
         "on either side.",
         "She hits the choreography on every beat, sharp arm and hip moves, then a turn; the robots swoop and "
         "tilt in perfect sync with her; the LED screens pulse; the camera dollies in."),
        ("close", "Close-up: she winks and makes a finger heart toward the camera; the white robot projects a "
         "glowing heart-shaped hologram beside her face, the black robot behind.",
         "She winks, makes the finger heart and laughs; the hologram heart pops and sparkles; gentle push-in."),
        ("play", "A waterfall of sparkler fireworks pours across the back of the stage and silver confetti fills "
         "the air; she stands centre stage playing the electric shamisen with the bachi, the LED screens exploding "
         "with stars; the robots spin as spotlights.",
         "Within the first second the sparkler waterfall ignites and silver confetti bursts; she strikes the "
         "strings with the bachi at full energy; the robots sweep spotlights over the crowd."),
    ],
    "voltage-rush": [
        ("play", "She stands on top of the glowing DJ booth playing the electric shamisen with the bachi, one foot "
         "on the edge; the black and white robots on either side act as speakers blasting visible bass shock waves.",
         "She strikes the strings with the bachi and pumps the bachi in the air on the beat; visible bass shock "
         "waves pulse out of the robots; the crowd silhouettes jump."),
        ("robots", "No girl in this shot. Wide shot over the festival crowd at night: the black robot and the "
         "white robot fly above thousands of raised hands, firing green and yellow laser beams from their ring "
         "lenses across the smoky sky.",
         "The robots swoop over the crowd, criss-crossing their laser beams on every beat; the crowd jumps; "
         "flames burst from the speaker towers."),
        ("close", "Extreme close low angle on her face as she shouts with joy, hair flying, one fist raised, "
         "lightning arcs crackling between the black and white robots above her head.",
         "She throws her head back and shouts, then grins at the camera; lightning arcs jump between the robots "
         "on the beat; sparks rain down."),
        ("dance", "The bass drop: a massive ring-shaped shock wave of light bursts outward from her as she jumps "
         "high with both arms raised, the shamisen on her back, CO2 jets firing; the two robots spin at her sides.",
         "Within the first second the shock wave ring bursts out and the smoke is blown away; she jumps on every "
         "beat with her arms in the air; CO2 jets fire; camera shake."),
    ],
    "pixel-quest": [
        ("story", "Side view: she jumps from one floating pixel-art island to another like a platform-game hero, "
         "the shamisen on her back; the black and white robots follow with sparkly pixel trails.",
         "She leaps from island to island; the camera tracks sideways; pixel sparkles burst where she lands; the "
         "robots follow her jumps."),
        ("robots", "No girl in this shot. The black robot and the white robot fly through the turquoise pixel "
         "sky collecting big floating golden pixel stars, one star bursting into sparkles as the white robot "
         "touches it.",
         "The robots dart from star to star, each one bursting into pixel sparkles; the black robot bumps into a "
         "pixel cloud and bounces off; the white robot spins happily."),
        ("close", "Close-up of her determined face, wind in her hair, the glow of a giant purple pixel-art dragon "
         "reflected in her eyes; the black robot at her shoulder.",
         "Slow push-in. She narrows her eyes, then smirks with confidence; pixel embers drift past; the robot's "
         "lens flashes."),
        ("play", "She stands on a crystal facing a giant friendly pixel-art dragon made of purple and pink pixels "
         "in the sky, playing a power chord on the electric shamisen with the bachi that blasts a wave of pixel "
         "hearts; a pixel rainbow behind; the robots at her sides.",
         "Within the first second she strikes the strings with the bachi and a huge wave of pixel hearts and stars "
         "bursts out; the dragon turns into a shower of pixel stars and a pixel rainbow appears; the robots spin."),
    ],
    "neon-riot": [
        ("play", "She stands on top of a stack of plain black amplifiers playing a fierce solo on the electric "
         "shamisen with the bachi, one foot on the edge; the black and white robots on either side blow stage smoke.",
         "She strikes the strings hard with the bachi and kicks one foot; red and pink spotlights strobe; smoke "
         "blasts from the robots; slow push-in from below."),
        ("story", "She crowd-surfs on her back over a sea of raised hands, laughing, the shamisen held up above "
         "her; the black and white robots fly above her under the red spotlights.",
         "The crowd passes her along over their heads; she laughs and throws one fist up; the robots follow "
         "overhead; spotlights swing."),
        ("robots", "No girl in this shot. The black robot and the white robot alone on top of the black amp stack "
         "under red and hot-pink spotlights, headbanging, puffs of stage smoke shooting out from under them.",
         "The two robots headbang in sync, tipping forward and back on every beat, then bump into each other; "
         "smoke blasts; strobes flash."),
        ("dance", "She leaps high into the air in a punk jump kick, the shamisen on her back, pyrotechnic sparks "
         "erupting behind her; the two robots spin beside her.",
         "Within the first second the pyrotechnics erupt; she lands and pogo-jumps wildly on the beat with her fist "
         "up; the robots spin; camera shake."),
    ],
    "hyper-circuit": [
        ("story", "She surfs through the cyber tunnel crouched on the black robot like a hoverboard, one hand "
         "touching it, the shamisen on her back; the white robot flies just ahead of her.",
         "Extreme speed: the circuit tunnel rushes past; she leans into a curve, hair whipping; the white robot "
         "weaves ahead."),
        ("close", "Close-up of her from the chest up: streams of red and cyan data light reflect across her face, "
         "eyes glowing; the white robot (same helmet shape as [Image 3], seen whole and small) floats behind her "
         "shoulder.",
         "Data streams rush over her face; she looks up into the camera and smiles; slow push-in."),
        ("robots", "No girl in this shot. The black robot and the white robot race through the glowing red and "
         "cyan circuit tunnel in a tight double helix, leaving spiralling light trails.",
         "The two robots spiral around each other at extreme speed down the tunnel; the circuit lines streak past; "
         "their light trails braid together."),
        ("play", "She bursts out of the end of the tunnel into an open digital sky playing the electric shamisen "
         "with the bachi, hexagon shards exploding around her; the two robots burst out with her.",
         "Within the first second the tunnel end shatters into hexagon shards; she flies out into open sky striking "
         "the strings with the bachi; the robots spin around her."),
    ],
    "fur-elise": [
        ("story", "She sits at the black grand piano playing the keys with both hands, the shamisen resting on top "
         "of the piano; the black and white robots float above the piano glowing like candles.",
         "She plays the piano gracefully and sways; the robots glow softly; candle flames flicker; petals drift."),
        ("play", "Seen from outside through the tall arched window: moonlight on her face as she plays the "
         "electric shamisen with the bachi inside, cherry petals on the glass; the white robot and black robot "
         "beside her.",
         "Slow push toward the window; she plays with eyes closed; petals slide down the glass."),
        ("robots", "No girl in this shot. The black robot and the white robot alone on the keyboard of the black "
         "grand piano in the moonlight, hopping on the keys to play a duet.",
         "The two robots hop from key to key in turn, the keys pressing down under them; candle flames flicker; "
         "petals drift through the moonbeams."),
        ("dance", "All the chandeliers ignite at once and the hall fills with swirling cherry petals and moonbeams; "
         "she waltzes alone in the centre of the hall, the shamisen on her back, kimono sleeves flowing; the two "
         "robots circle her like dance partners.",
         "Within the first second every chandelier bursts into light and a whirlwind of petals rises; she waltzes "
         "in a graceful turn; the robots circle with her; the camera rises."),
    ],
}

CLIP_PROMPT = (
    "3D toon-shaded CG anime music video, keep the exact 3D rendering style, lighting, character design and colours of the first frame. "
    "No text, no subtitles, no captions, no readable letters appear at any time. {sec:.0f}-second shot. "
    "Mood: {mood}, music at about {bpm} BPM. {action} "
    "The black robot and the white robot keep their exact design and colours the whole time; "
    "there are never any other robots or drones. "
    "{subject} No cuts, one continuous shot."
)
SUBJECT = {"robots": "Only the two robots are in this shot; the girl never appears. They stay small round flying "
                     "helmets the whole time: they never transform, never grow legs, arms, jets or a face.",
           "play": "She stays recognisable and in frame. The instrument keeps exactly three strings and three "
                   "tuning pegs and she strikes the strings with the blue paddle-shaped bachi, never like a guitar pick.",
           "_": "She stays recognisable and in frame; if the shamisen is visible it keeps exactly three strings and "
                "three tuning pegs."}


def shot_desc(song, shot):
    """(kind, keyframe composition, clip action)"""
    return STORYBOARD[song][SHOTS.index(shot)]


def key():
    k = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not k:
        sys.exit("GEMINI_API_KEY is not set")
    return k


def post(url, body, timeout=900, tries=3):
    err = ""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", "x-goog-api-key": key()})
            return json.load(urllib.request.urlopen(req, timeout=timeout))
        except urllib.error.HTTPError as e:
            err = f"HTTP {e.code}: {e.read().decode()[:400]}"
            if e.code in (400, 401, 403, 404):
                break
        except Exception as e:
            err = str(e)
        time.sleep(8 * (i + 1))
    raise RuntimeError(err)


def b64(path):
    return base64.b64encode(open(path, "rb").read()).decode()


def mime(path):
    return "image/jpeg" if path.endswith((".jpg", ".jpeg")) else "image/png"


def path(kind, song, shot, ext):
    return os.path.join(WORK, kind, f"{song}-{shot}.{ext}")


def out_clip(song, shot):
    return os.path.join(OUT, f"{song}-{shot}.mp4")


def jobs(ids):
    return [(s, sh) for s in ids for sh in SHOTS]


# ---------- keyframes ----------
def keyframe(song, shot):
    dst = path("kf", song, shot, "png")
    if os.path.exists(dst):
        return f"{song}-{shot}: keyframe exists"
    s, (kind, desc, _) = SONGS[song], shot_desc(song, shot)
    refs = [os.path.join(REFS, f) for f in ("guye_3d_sheet.jpg", "robot_black.jpg", "robot_white.jpg", "shamisen_ref.jpg")]
    # [Image 5]: an accepted frame (this song's shot 1, or a stock one) pins the 3D look of her and the robots
    first = path("kf", song, "1", "png")
    chain = first if shot != "1" and os.path.exists(first) else os.path.join(REFS, "scene_3d.jpg")
    if os.path.exists(chain):
        refs.append(chain)
    prompt = (
        f"[Image 1] is the 3D character model sheet of {GIRL}. [Image 2] is the BLACK robot and [Image 3] the "
        f"WHITE robot, {ROBOTS}; both are real 3D renders. [Image 4] is the official 2D art of her instrument: "
        f"{SHAMISEN}; copy that instrument design exactly (the 3D sheet shows it in 3D). Render a NEW 3D CG music-video frame in exactly the same "
        "3D toon-shaded rendering style as [Image 1] (3D anime game character model with real volume, soft "
        "physically based lighting, rim light) and the robots with the same 3D materials as [Image 2] and "
        "[Image 3]. Cinematic 3D lighting: volumetric light beams through haze, bloom, reflections, shallow depth "
        "of field. NOT a flat 2D illustration. Keep her exact face, hair, outfit and shamisen and the robots' exact "
        "design: her outfit is short (open kimono jacket over a short pink dress, bare legs, white socks, black "
        "platform sandals), never a long kimono. "
        + ("[Image 5] is an approved frame: match how she, her shamisen and both robots look and are rendered "
           "there exactly (same robot shapes, same hair colour, same outfit), but do NOT copy its pose, camera "
           "angle or composition: the setting and shot below are new.\n" if len(refs) > 4 else "\n") +
        f"Setting: {s['place']}. Mood: {s['mood']}.\n"
        f"Shot: {desc}\n"
        + ("The girl does NOT appear in this shot at all: only the two robots (the references are just for "
           "their design). EXACTLY TWO robots in the whole frame, one black and one white: no copies, no "
           "reflections or echoes of them, no second pair. " if kind == "robots" else "She is clearly visible with her whole head in frame. ") +
        "Never more than these two robots (one black, one white) and no other drones or robots. "
        "Absolutely no text, letters, words, brand names, logos, watermarks or captions anywhere, not even on signs. Full-bleed 16:9 single frame."
    )
    parts = []
    for i, r in enumerate(refs, 1):
        parts += [{"text": f"[Image {i}]:"}, {"inlineData": {"mimeType": mime(r), "data": b64(r)}}]
    parts.append({"text": prompt})
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE", "TEXT"], "imageConfig": {"aspectRatio": "16:9"}}}
    for _ in range(3):
        d = post(f"{BASE}/models/{IMAGE_MODEL}:generateContent", body, 300)
        imgs = [p["inlineData"]["data"] for c in d.get("candidates", []) for p in c.get("content", {}).get("parts", [])
                if "inlineData" in p]
        if imgs:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, "wb").write(base64.b64decode(imgs[-1]))
            return f"{song}-{shot}: keyframe saved"
    return f"{song}-{shot}: keyframe FAILED"


# ---------- clips ----------
def clip(song, shot):
    dst = path("raw", song, shot, "mp4")
    kf = path("kf", song, shot, "png")
    if os.path.exists(dst):
        return f"{song}-{shot}: clip exists"
    if not os.path.exists(kf):
        return f"{song}-{shot}: no keyframe"
    s = SONGS[song]
    kind, _, action = shot_desc(song, shot)
    prompt = CLIP_PROMPT.format(sec=CLIP_SEC, mood=s["mood"], bpm=s["bpm"], action=action,
                                subject=SUBJECT.get(kind, SUBJECT["_"]))
    body = {"model": CLIP_MODEL,
            "input": [{"type": "image", "data": b64(kf), "mime_type": "image/png"}, {"type": "text", "text": prompt}],
            "response_format": {"type": "video", "aspect_ratio": "16:9", "resolution": "720p", "delivery": "uri"}}
    err = ""
    for _ in range(2):
        try:
            d = post(f"{BASE}/interactions", body, 900)
            vids = [c for st in d.get("steps", []) if st.get("type") == "model_output"
                    for c in st.get("content", []) if c.get("type") == "video"]
            if vids:
                v = vids[-1]
                data = base64.b64decode(v["data"]) if v.get("data") else fetch(v["uri"])
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, "wb").write(data)
                return f"{song}-{shot}: clip saved"
            err = json.dumps(d)[:300]
        except Exception as e:
            err = str(e)[:300]
    return f"{song}-{shot}: clip FAILED {err}"


def fetch(uri):
    uri += ("&" if "?" in uri else "?") + f"key={key()}"
    for _ in range(120):
        try:
            return urllib.request.urlopen(uri, timeout=300).read()
        except Exception:
            time.sleep(5)
    raise RuntimeError("download failed")


# ---------- web encode: 720p, no audio, a keyframe every second (the FEVER clip is pre-seeked), no B-frames ----------
def encode(song, shot):
    src, dst = path("raw", song, shot, "mp4"), out_clip(song, shot)
    if not os.path.exists(src):
        return f"{song}-{shot}: no clip"
    if os.path.exists(dst):
        return f"{song}-{shot}: encoded exists"
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-t", str(CLIP_SEC), "-an",
                    "-vf", "scale=1280:720:flags=lanczos,fps=24", "-c:v", "libx264", "-profile:v", "main",
                    "-preset", "slow", "-crf", "28", "-g", "24", "-keyint_min", "24", "-sc_threshold", "0",
                    "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], check=True)
    return f"{song}-{shot}: encoded"


# ---------- tracking: her horizontal centre every 0.25 s ----------
def track(song, shot):
    src, dst = out_clip(song, shot), path("track", song, shot, "json")
    if os.path.exists(dst):
        return f"{song}-{shot}: track exists"
    if not os.path.exists(src):
        return f"{song}-{shot}: no encoded clip"
    n = int(CLIP_SEC * 4)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", "fps=4,scale=384:-2",
                        "-frames:v", str(n), os.path.join(tmp, "f%03d.jpg")], check=True)
        frames = sorted(f for f in os.listdir(tmp) if f.endswith(".jpg"))
        parts = []
        for i, f in enumerate(frames):
            parts += [{"text": f"frame {i}"}, {"inlineData": {"mimeType": "image/jpeg", "data": b64(os.path.join(tmp, f))}}]
    parts.append({"text": (
        f"These are {len(frames)} consecutive frames of one video. In each frame find the anime girl (not the "
        "robots) and give the horizontal centre of her body (head to feet, ignore the instrument; if she is not "
        "in the video, use the midpoint between the two flying robots instead) as a fraction "
        "of the frame width, 0 = left edge, 1 = right edge. Answer with only a JSON array of "
        f"{len(frames)} numbers, one per frame, in order.")})
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    d = post(f"{BASE}/models/{TRACK_MODEL}:generateContent", body, 300)
    text = "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"])
    xs = [float(x) for x in json.loads(text)][:len(frames)]
    xs += [xs[-1]] * (n - len(xs))
    sm = [sum(xs[max(0, i - 1):i + 2]) / len(xs[max(0, i - 1):i + 2]) for i in range(n)]
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump([round(min(0.9, max(0.1, x)), 2) for x in sm], open(dst, "w"))
    return f"{song}-{shot}: tracked"


# ---------- manifest ----------
def manifest():
    songs = {}
    for song in SONGS:
        entry = {"clips": []}
        for shot in SHOTS:
            src, tr = out_clip(song, shot), path("track", song, shot, "json")
            if not (os.path.exists(src) and os.path.exists(tr)):
                continue
            c = {"src": os.path.basename(src), "track": json.load(open(tr))}
            if shot == "fever":
                c["at"] = FEVER_AT
                entry["fever"] = c
            else:
                entry["clips"].append(c)
        if entry["clips"]:
            songs[song] = entry
    os.makedirs(OUT, exist_ok=True)
    json.dump({"songs": songs}, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=1)
    print(f"manifest: {len(songs)} songs")


def run(fn, ids, workers):
    with cf.ThreadPoolExecutor(workers) as pool:
        futs = [pool.submit(fn, s, sh) for s, sh in jobs(ids)]
        for f in cf.as_completed(futs):
            try:
                print(f.result(), flush=True)
            except Exception as e:
                print("ERROR", e, flush=True)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    ids = sys.argv[2:] or list(SONGS)
    bad = [i for i in ids if i not in SONGS]
    if bad:
        sys.exit(f"unknown song ids: {bad}")
    steps = {"keyframes": (keyframe, 6), "clips": (clip, 6), "encode": (encode, 4), "track": (track, 6)}
    for name in (["keyframes", "clips", "encode", "track"] if step == "all" else [step] if step in steps else []):
        print(f"== {name}", flush=True)
        run(*steps[name][:1], ids, steps[name][1])
    if step in ("all", "manifest"):
        manifest()
