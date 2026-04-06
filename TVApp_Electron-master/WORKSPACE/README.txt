WORKSPACE – conținut per echipă pentru Digital Signage

Fiecare subdirector = o echipă (ex: SAM, CAIRs, ESB).
La prima pornire a aplicației se alege echipa pentru TV; selecția se salvează.

În fiecare director de echipă:
  - playlist.json   = ce se afișează pe TV (liste de slide-uri)
  - documents/      = PDF direct; pentru PPT/Word/Excel = folder cu imagini exportate (ex: ppt_export/, word_export/)
  - photos/         = imagini (SAM, ESB) – sau images/ (CAIRs)
  - videos/         = video (ex: .mp4, .webm)

PPT / Word / Excel se afișează ca imagini: exportă slide-urile/paginile în PNG/JPG într-un folder, apoi în playlist pune type: pptx (sau word/excel) și src: calea folderului (ex: documents/ppt_export).

Căile din "src" în playlist.json sunt relative la directorul echipei:
  - photos/nume.jpg   sau  images/nume.jpg
  - videos/nume.mp4
  - documents/nume.pdf
  - documents/ppt_export   (folder cu imagini exportate din PowerPoint)
  - documents/word_export, documents/excel_export   (idem pentru Word/Excel)

Exemplu playlist.json:
  {
    "slides": [
      { "id": "1", "type": "image", "src": "photos/echipa.jpg", "duration": 10, "title": "Echipa" },
      { "id": "2", "type": "video", "src": "videos/promo.mp4", "duration": 20, "title": "Video" },
      { "id": "3", "type": "pdf", "src": "documents/ghid.pdf", "duration": 15, "title": "PDF" },
      { "id": "4", "type": "web_url", "src": "https://...", "duration": 15, "title": "Web" }
    ]
  }

Tipuri suportate: image, video, web_url, pdf, pptx, word, excel, youtube, vimeo, hls.
Conținutul se reîmprospătează la pull Git și o dată pe oră.
