-- ============================================================
-- Techxfluence — seed the 7 sample events + speakers (from data.ts)
-- Run AFTER full_setup.sql, in the Supabase SQL Editor.
-- Idempotent: existing events (by slug) are skipped along with their speakers.
-- ============================================================
do $$
declare
  ev jsonb;
  sp jsonb;
  v_event_id uuid;
  v_speaker_id uuid;
  i int;
  events_json jsonb := $json$
  [
    {
      "slug":"ai-meetup-chennai","title":"AI Meetup Chennai","category":"Meetup",
      "date":"2026-07-12","date_label":"Jul 12, 2026","time":"10:00 AM – 1:00 PM IST",
      "city":"Chennai","venue":"IIT Madras Research Park","address":"Kanagam Road, Taramani, Chennai 600113",
      "price_type":"Free","price_label":"Free","price_amount":0,"capacity":80,"spots_left":18,
      "image_url":"/events/meetup.jpg",
      "blurb":"Builders shipping with LLMs swap notes on agents, RAG and evals over coffee.",
      "about":"A morning for practitioners building with large language models. Expect lightning talks on agents, retrieval and evaluation, followed by open Q&A and plenty of hallway conversation. Bring your hardest problem — someone in the room has probably solved it.",
      "speakers":[
        {"name":"Nikhil Varma","role":"ML Engineer, Freshworks","initials":"NV"},
        {"name":"Sneha Pillai","role":"Founder, RetrievaAI","initials":"SP"}
      ]
    },
    {
      "slug":"startup-networking-night","title":"Startup Networking Night","category":"Networking",
      "date":"2026-07-19","date_label":"Jul 19, 2026","time":"6:30 PM – 9:30 PM IST",
      "city":"Bengaluru","venue":"WeWork Galaxy, Residency Road","address":"43 Residency Road, Bengaluru 560025",
      "price_type":"Paid","price_label":"₹299","price_amount":29900,"capacity":60,"spots_left":7,
      "image_url":"/events/networking.jpg",
      "blurb":"Founders, operators and angels in one room. Curated intros, no pitch-deck spam.",
      "about":"An evening of intentional networking. We curate introductions based on what you're building and what you need, so you leave with three conversations worth following up — not a pocket full of forgotten business cards.",
      "speakers":[
        {"name":"Arjun Reddy","role":"Partner, Seedstage Capital","initials":"AR"},
        {"name":"Lakshmi Iyer","role":"Founder, two exits","initials":"LI"}
      ]
    },
    {
      "slug":"cybersecurity-workshop","title":"Cybersecurity Workshop","category":"Workshop",
      "date":"2026-07-26","date_label":"Jul 26, 2026","time":"9:00 AM – 4:00 PM IST",
      "city":"Hyderabad","venue":"T-Hub, Madhapur","address":"T-Hub 2.0, Inorbit Mall Road, Madhapur, Hyderabad 500081",
      "price_type":"Paid","price_label":"₹499","price_amount":49900,"capacity":40,"spots_left":24,
      "image_url":"/events/workshop.jpg",
      "blurb":"Hands-on red-team / blue-team lab. Walk out with a hardened threat model.",
      "about":"A full-day, laptop-required workshop. You'll attack a deliberately vulnerable app, then defend it — learning practical threat modelling, common exploit classes and the fixes that actually hold up. Beginner-friendly but not beginner-paced.",
      "speakers":[
        {"name":"Imran Sheikh","role":"Security Lead, PayStack","initials":"IS"},
        {"name":"Divya Menon","role":"Pentester & CTF organizer","initials":"DM"}
      ]
    },
    {
      "slug":"product-launch-summit","title":"Product Launch Summit","category":"Product Launch",
      "date":"2026-08-02","date_label":"Aug 02, 2026","time":"5:00 PM – 9:00 PM IST",
      "city":"Chennai","venue":"Taj Coromandel","address":"37 Mahatma Gandhi Road, Nungambakkam, Chennai 600034",
      "price_type":"Paid","price_label":"₹999","price_amount":99900,"capacity":200,"spots_left":40,
      "image_url":"/events/launch.jpg",
      "blurb":"Watch 8 startups unveil to press, investors and the TXF community on one stage.",
      "about":"Eight teams. Eight launches. One stage. The Product Launch Summit gives early-stage startups a moment in front of press, investors and the community — with live demos, a fireside chat and an after-party for the conversations that matter.",
      "speakers":[
        {"name":"Kavya Rao","role":"Editor, TechCircle","initials":"KR"},
        {"name":"Sandeep Nair","role":"GP, Equinox Ventures","initials":"SN"}
      ]
    },
    {
      "slug":"hackathon-2026","title":"Hackathon 2026","category":"Hackathon",
      "date":"2026-08-15","end_date":"2026-08-16","date_label":"Aug 15–16, 2026","time":"Starts 9:00 AM, 36 hours",
      "city":"Coimbatore","venue":"PSG College of Technology","address":"Avinashi Road, Peelamedu, Coimbatore 641004",
      "price_type":"Free","price_label":"Free","price_amount":0,"capacity":300,"spots_left":56,
      "image_url":"/events/hackathon.jpg",
      "blurb":"36 hours, ₹3L in prizes, mentors from top product teams. Build something real.",
      "about":"Our flagship build sprint. Form a team, pick a track and ship a working prototype in 36 hours with mentors on call the whole way. ₹3,00,000 in prizes, recruiter access and bragging rights for the winning crew. Solo hackers welcome — we'll help you find a team.",
      "speakers":[
        {"name":"Rahul Krishnan","role":"Staff Engineer, Razorpay","initials":"RK"},
        {"name":"Aisha Khan","role":"Design Lead, Zoho","initials":"AK"}
      ]
    },
    {
      "slug":"scaling-systems-webinar","title":"Scaling Systems Webinar","category":"Webinar",
      "date":"2026-07-30","date_label":"Jul 30, 2026","time":"7:00 PM – 8:30 PM IST",
      "city":"Online","venue":"Live on Zoom","address":"Online — link emailed on registration",
      "price_type":"Free","price_label":"Free","price_amount":0,"capacity":500,"spots_left":220,
      "image_url":"/events/webinar.jpg",
      "blurb":"How real teams scale from 10K to 10M users — architecture, caching and on-call.",
      "about":"A live, online deep-dive into scaling backends. We'll walk through real architecture decisions — databases, caching layers, queues and observability — with time for your questions. Recording shared with everyone who registers.",
      "speakers":[
        {"name":"Vivek Anand","role":"Principal Engineer, Swiggy","initials":"VA"},
        {"name":"Pooja Shetty","role":"SRE Lead, CRED","initials":"PS"}
      ]
    },
    {
      "slug":"designops-meetup","title":"DesignOps Meetup","category":"Meetup",
      "date":"2026-08-23","date_label":"Aug 23, 2026","time":"11:00 AM – 2:00 PM IST",
      "city":"Chennai","venue":"Anna Nagar Tower Park Hall","address":"Anna Nagar Tower Park, 2nd Avenue, Chennai 600040",
      "price_type":"Free","price_label":"Free","price_amount":0,"capacity":70,"spots_left":30,
      "image_url":"/events/meetup.jpg",
      "blurb":"Designers and PMs on systems, handoff and shipping faster without breaking craft.",
      "about":"Where design meets delivery. Talks and a panel on design systems, smoother handoff and scaling craft as teams grow — plus space to compare notes with designers and PMs who care about both speed and quality.",
      "speakers":[
        {"name":"Meera Joseph","role":"Design Systems Lead, Freshworks","initials":"MJ"},
        {"name":"Tarun Gupta","role":"Group PM, Chargebee","initials":"TG"}
      ]
    }
  ]
  $json$::jsonb;
begin
  for ev in select * from jsonb_array_elements(events_json) loop
    insert into public.events
      (slug,title,category,date,end_date,date_label,time,city,venue,address,
       price_type,price_label,price_amount,blurb,about,capacity,spots_left,image_url,
       status,source,published_at)
    values (
      ev->>'slug', ev->>'title', (ev->>'category')::event_category, (ev->>'date')::date,
      nullif(ev->>'end_date','')::date, ev->>'date_label', ev->>'time', ev->>'city',
      ev->>'venue', ev->>'address', (ev->>'price_type')::price_type, ev->>'price_label',
      coalesce((ev->>'price_amount')::int,0), ev->>'blurb', ev->>'about',
      (ev->>'capacity')::int, (ev->>'spots_left')::int, ev->>'image_url',
      'published','system', now()
    )
    on conflict (slug) do nothing
    returning id into v_event_id;

    -- only seed speakers for newly inserted events (keeps re-runs idempotent)
    if v_event_id is not null then
      i := 0;
      for sp in select * from jsonb_array_elements(ev->'speakers') loop
        insert into public.speakers (name, role, initials)
        values (sp->>'name', sp->>'role', sp->>'initials')
        returning id into v_speaker_id;

        insert into public.event_speakers (event_id, speaker_id, sort_order)
        values (v_event_id, v_speaker_id, i)
        on conflict (event_id, speaker_id) do nothing;
        i := i + 1;
      end loop;
    end if;
  end loop;
end $$;
