# Stage 0: Accent spike

This is the test from the Voice design doc — before we build the "speak instead
of typing" feature, we need to find out if speech recognizers actually
understand Liberian English. This folder is a throwaway test, not part of the
real Kaeya app.

## What to do

1. **Record 10 short clips.** Use your phone's voice recorder or a WhatsApp
   voice note. Ask 10 real people (the teacher, a couple other teachers,
   friends already using Kaeya) to say ONE real Kaeya request, in their own
   words, at their normal speaking speed. Not read off a script.

   Example requests to give them if they're stuck:
   - "Write twenty division questions for grade five."
   - "How do I forward this email?"
   - "Summarize this."
   - "Translate this to French."
   - "Explain what's on my screen."

   Try to get 2–3 of the 10 recorded right in the classroom, with normal
   background noise — that answers a second question for free (does voice
   even work with kids talking in the background?).

2. **Save the files into the `clips` folder** next to this README. Any format
   is fine — however your phone saves them (`.m4a`, `.mp3`, `.wav`, whatever).

3. **Tell me you're done.** I'll run the script and bring back a scorecard
   showing what Gemini (and Whisper, once OpenAI credit is added) heard for
   each clip.

4. **You mark each one right or wrong.** Compare what the computer heard to
   what was actually said, and tick yes/no. Add up the ticks — that's your
   number. That number decides whether "speak instead of type" is worth
   building, per the approved design.

## What this is NOT

- Not code inside the Kaeya app. Nothing here ships to users.
- Not a decision by itself — you make the call once you see the number.
