#!/usr/bin/env python3
"""Render the voice-acted lines (cutscenes and interview questions) to www/audio/vo/*.mp3 and write the line table
to www/js/vo-lines.js. This file is the single source for every voiced line.

Voices: Kokoro-82M (Apache-2.0), run locally with kokoro-onnx.
  model:  npm `kokoro-q8-shards` (cat kokoro-q8.part0..5.bin > kokoro-q8.onnx)
  voices: npm `kokoro-local-runtime` (package/voices/*.bin)
Usage:  python3 tools/build_voices.py <kokoro-q8.onnx> <voices dir>
Needs:  pip install kokoro-onnx soundfile; ffmpeg on the PATH.

Lines are recorded ahead of time, so they can't say the player's custom name: they use "kid", "rook" etc.
"""
import glob, json, os, subprocess, sys, tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'www', 'audio', 'vo')

CAST = {
    'narrator': ('am_michael', 1.0), 'coach': ('am_onyx', 0.95), 'you': ('am_liam', 1.0), 'rival': ('am_fenrir', 1.02),
    'star': ('am_puck', 1.0), 'mate': ('am_echo', 1.05), 'dre': ('am_eric', 1.05), 'press': ('am_adam', 1.0),
    'courtside': ('af_heart', 1.05), 'beat': ('af_sarah', 1.0), 'tv': ('am_michael', 0.97), 'announcer': ('am_adam', 1.12),
}

LINES = {
    # First high school game
    'debut_1': ('narrator', 'Packed gym tonight. Your first varsity game, and every seat in the building is full.'),
    'debut_2': ('coach', 'Get loose, kid. Scouts are in the stands tonight. Let them see what we see.'),
    'debut_3': ('you', "Breathe. Same rim as the driveway. Let's work."),
    # State championship trash talk
    'trash_1': ('rival', "So you're the one everybody's been talking about? Rankings don't mean nothing in a state final."),
    'trash_2': ('you', "Guess we'll find out in about ten minutes."),
    'trash_3': ('rival', "Tell your folks to film it. You're ending up on my poster."),
    'trash_4': ('coach', "Don't let him in your head. Let your game do the talking. Bring that trophy home."),
    # College rival
    'rival_1': ('rival', "Saw your little highlight tape. Cute. Everybody keeps saying your name like I'm not in this conference."),
    'rival_2': ('you', "Keep saying mine, then. I'll give you something to say it about."),
    'rival_3': ('rival', "Check the stat sheet after tonight. Mine's gonna be longer. It always is."),
    'rival_4': ('mate', "He's been talking about this one all week. Make him eat it."),
    # Heated NBA rivalry / Finals
    'heated_1': ('star', "You again. Last time you got lucky. Not happening in my building."),
    'heated_2': ('you', 'Lucky? Look at the scoreboard from last time.'),
    'heated_3': ('star', "Keep talking. We'll see who's still standing in the fourth."),
    'heated_4': ('mate', 'Easy, easy. Save it for the game. They want you to lose your head.'),
    # In-game announcer: GOAT skill activations
    'goat_finishing': ('announcer', 'Oh! GOAT Finisher, activated! Nobody is stopping him at the rim!'),
    'goat_shooting': ('announcer', 'GOAT Shooter, activated! He is cooking from everywhere!'),
    'goat_playmaking': ('announcer', 'GOAT Playmaker, activated! He has got them on a string!'),
    'goat_defense': ('announcer', 'GOAT Defender, activated! Lock him up, nothing is getting through!'),
    'goat_rebounding': ('announcer', 'GOAT Rebounder, activated! Every board belongs to him now!'),
    # Interviews: the intro is narrated, the questions are asked by the interviewer
    'iv_college_intro': ('narrator', 'A camera crew catches you outside the gym on your first day on campus.'),
    'iv_college_0': ('dre', "Everybody's calling you the best freshman in the country. You agree?"),
    'iv_college_1': ('dre', "What's the one thing people don't know about your game?"),
    'iv_college_2': ('dre', 'Message to your future rival?'),
    'iv_draft_intro': ('narrator', 'Cameras flash as you sit down at the podium in your new hat.'),
    'iv_draft_0': ('press', 'How does it feel to be a pro?'),
    'iv_draft_1': ('press', 'What do you bring to this team on day one?'),
    'iv_postgame_intro': ('narrator', 'A reporter grabs you on the way to the locker room.'),
    'iv_postgame_0': ('courtside', 'Big night for you. What was working?'),
    'iv_postgame_1': ('courtside', 'The fans were chanting your name. How did that feel?'),
    'iv_slump_intro': ('narrator', 'After a rough stretch, the beat writers want answers.'),
    'iv_slump_0': ('beat', "You've been off lately. What's going on?"),
    'iv_slump_1': ('beat', 'Any frustration with your role?'),
    'iv_playoffs_intro': ('narrator', 'The lights are brighter now. The whole country is listening.'),
    'iv_playoffs_0': ('tv', 'Is this the moment you become a household name?'),
    'iv_playoffs_1': ('tv', 'Any words for the other team?'),
}


def main(model, voices_dir):
    import numpy as np, soundfile as sf
    from kokoro_onnx import Kokoro
    tmp = tempfile.mkdtemp()
    vox = {os.path.basename(f)[:-4]: np.fromfile(f, dtype=np.float32).reshape(-1, 1, 256) for f in glob.glob(os.path.join(voices_dir, '*.bin'))}
    vpath = os.path.join(tmp, 'voices.npz')
    np.savez(vpath, **vox)
    k = Kokoro(model, vpath)
    os.makedirs(OUT, exist_ok=True)
    table = {}
    for lid, (role, text) in LINES.items():
        voice, speed = CAST[role]
        audio, sr = k.create(text, voice=voice, speed=speed, lang='en-us')
        wav = os.path.join(tmp, lid + '.wav')
        sf.write(wav, audio, sr)
        mp3 = os.path.join(OUT, lid + '.mp3')
        # A touch of room and a little loudness so it sits over the crowd
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', 'highpass=f=70,acompressor=threshold=-20dB:ratio=3,loudnorm=I=-16:TP=-1.5',
                        '-ac', '1', '-ar', '24000', '-b:a', '48k', mp3], check=True)
        table[lid] = {'role': role, 'text': text, 'dur': round(len(audio) / sr, 2)}
        print(f'{lid:22s} {voice:11s} {len(audio) / sr:5.2f}s')
    with open(os.path.join(ROOT, 'www', 'js', 'vo-lines.js'), 'w') as f:
        f.write('// Generated by tools/build_voices.py: voice-acted lines (audio in audio/vo/<id>.mp3)\n')
        f.write('export const VO = ' + json.dumps(table, indent=1, ensure_ascii=False) + ';\n')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
