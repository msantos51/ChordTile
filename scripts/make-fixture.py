# Gera tests/fixtures/exemplo.gp5: progressão conhecida (Intro, Verso, Refrão, Verso, Solo)
# com guitarra e baixo, para testar a deteção do tom (nomes em português, com acentos).
# Com --en gera a música de exemplo do site, em inglês: public/sample.gp5.
# Uso: pip install pyguitarpro && python scripts/make-fixture.py [--en]
import guitarpro as gp, copy, sys
EN = "--en" in sys.argv
song = gp.Song()
if EN: song.title="Sample song"; song.artist="Demo chart"
else: song.title="Exemplo"; song.artist="Esquema de demonstração"
song.tempo=100
VERSE, CHORUS = ("VERSE","CHORUS") if EN else ("VERSO","REFRÃO")
prog = [("INTRO",["A","B","A","B"]),(VERSE,["B","C","B","G"]*4),(CHORUS,["A","B","G","D"]*2),(VERSE,["B","C","B","G"]*4),("SOLO",["B","C","B","G","A","B","A","B"])]
PC={"C":0,"D":2,"E":4,"F":5,"G":7,"A":9,"B":11}
def chord(n):
    r=PC[n[0]]; m='m' in n
    return r,[0,3 if m else 4,7]
bars=[]
for s,ch in prog:
    for i,c in enumerate(ch): bars.append((s if i==0 else None,c))
# master bars
song.measureHeaders=[]
for i,(sec,c) in enumerate(bars):
    h=gp.MeasureHeader(); h.number=i+1; h.start=960+i*3840
    if sec: h.marker=gp.Marker(title=sec)
    song.measureHeaders.append(h)
gtr=song.tracks[0]; gtr.name="Guitar" if EN else "Guitarra"
bass=gp.Track(song,number=2,name="Bass" if EN else "Baixo",channel=gp.MidiChannel(channel=1,effectChannel=1,instrument=33))
bass.strings=[gp.GuitarString(n,v) for n,v in [(1,43),(2,38),(3,33),(4,28)]]
song.tracks.append(bass)
for t in song.tracks:
    t.measures=[]
    for h in song.measureHeaders: t.measures.append(gp.Measure(t,h))
def add(m,notes_by_beat,strings):
    v=m.voices[0]; v.beats=[]
    for pitches,dur in notes_by_beat:
        b=gp.Beat(v,duration=gp.Duration(value=dur)); b.status=gp.BeatStatus.normal
        for p in pitches:
            # find string
            for s in sorted(strings,key=lambda s:-s.value):
                if p>=s.value and p-s.value<=20 and all(n.string!=s.number for n in b.notes):
                    n=gp.Note(b,value=p-s.value,string=s.number,type=gp.NoteType.normal); b.notes.append(n); break
        v.beats.append(b)
for i,(sec,c) in enumerate(bars):
    r,iv=chord(c)
    root_g=52+((r-4)%12)
    add(song.tracks[0].measures[i],[([root_g+x for x in iv],2)]*2,gtr.strings)
    br=28+((r-4)%12)
    # bass: root, fifth, root, passing note (third)
    add(song.tracks[1].measures[i],[([br],4),([br+7],4),([br],4),([br+iv[1]+12 if br+iv[1]<28 else br+iv[1]],4)],bass.strings)
gp.write(song,"public/sample.gp5" if EN else "tests/fixtures/exemplo.gp5")
print("ok",len(bars))
