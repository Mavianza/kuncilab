# KunciLab

KunciLab adalah simulator interaktif untuk mempelajari deadlock antar-thread. Susun urutan `lock` dan `unlock`, pilih giliran tiap thread, lalu perhatikan kapan antrean biasa berubah menjadi siklus tunggu.

## Fitur

1. **Skenario yang bisa diubah.** Tiga preset bawaan membandingkan urutan mutex terbalik, urutan konsisten, dan siklus tiga thread. Editor JSON memeriksa instruksi sebelum memulai sesi.
2. **Penjadwalan dan visualisasi.** Jalankan satu thread per klik atau gunakan round-robin otomatis. Lihat pemilik mutex, antrean FIFO, graf tunggu, dan langkah yang menyebabkan siklus.
3. **Pemulihan dan undo.** Batalkan satu thread yang berada dalam deadlock. Mutex yang dilepas diberikan ke penunggu pertama. Mundur satu aksi untuk memeriksa state sebelumnya.
4. **Ekspor dan replay.** Simpan skenario dan aksi sebagai JSON, lalu putar ulang. Sesi aktif juga disimpan di penyimpanan lokal browser jika tersedia.

## Menjalankan

Gunakan Node.js 20 atau lebih baru. Ekstrak ZIP dan jalankan dari folder yang berisi `package.json`. Program menggunakan modul bawaan Node.js.

```powershell
node server.mjs
```

Buka alamat [http://127.0.0.1:8765](http://127.0.0.1:8765). Jika port sudah dipakai, jalankan `node server.mjs 8766` dan buka port tersebut.

Pada preset **Urutan terbalik**, klik **Jalankan otomatis**. Simulasi berhenti setelah empat langkah.

| Langkah | Hasil |
| --- | --- |
| 1 | T1 mengambil A. |
| 2 | T2 mengambil B. |
| 3 | T1 menunggu B milik T2. |
| 4 | T2 menunggu A milik T1. Graf menampilkan `T1 → T2 → T1`. |

Klik **Batalkan T2**. B diberikan ke T1, yang kemudian memegang A dan B. Klik **Jalankan otomatis** untuk menyelesaikan tiga instruksi T1 yang tersisa. Kamu juga bisa membuka **Skenario JSON dan replay**, lalu memuat `contoh/deadlock.json` untuk langsung melihat siklus pada langkah keempat.

## Format skenario

```json
{
  "name": "Berebut satu mutex",
  "locks": ["L"],
  "threads": [
    {
      "id": "T1",
      "steps": [{"op": "lock", "lock": "L"}, {"op": "unlock", "lock": "L"}]
    },
    {
      "id": "T2",
      "steps": [
        {"op": "lock", "lock": "L"},
        {"op": "work", "label": "Baca catatan"},
        {"op": "unlock", "lock": "L"}
      ]
    }
  ]
}
```

Skenario mendukung 2–12 thread, 1–16 mutex, dan maksimal 240 instruksi. Setiap mutex non-reentrant. Skenario harus melepas semua mutex sebelum thread selesai secara normal. `work` maju satu langkah dan hanya mencatat label aktivitas. Jejak versi 1 berisi `scenario` dan `commands` dengan aksi `step` atau `abort` serta ID `thread`.

## Jaminan dan batas model

**Skenario dan urutan aksi yang sama menghasilkan state, graf tunggu, dan riwayat yang sama.** Mesin menyalin state saat menerapkan satu aksi. Undo memakai snapshot sebelumnya. Replay membangun sesi baru secara penuh sebelum mengganti sesi aktif. Aksi yang tidak sah gagal tanpa menambah riwayat.

Graf menautkan thread yang terblokir ke pemilik mutex yang sedang ditunggu. Karena model memakai mutex dengan satu pemilik, siklus pada graf menunjukkan thread yang saling menunggu. Round-robin otomatis berhenti pada siklus pertama yang muncul atau ketika tidak ada thread siap. Saat mutex dilepas, penunggu terdepan langsung memperoleh mutex dan instruksi `lock` yang tertunda dianggap selesai.

Pembatalan thread adalah operasi simulator yang mengeluarkan thread dari antrean dan melepas semua mutex miliknya dalam satu aksi. Efek `work` hanya berupa label, sehingga model hanya memulihkan status mutex dan thread. Eksekusi paralel sungguhan, timeout, dan rollback efek bisnis berada di luar cakupan model.

| Berkas | Tanggung jawab |
| --- | --- |
| `web/sim.mjs` | Validasi, transisi state, FIFO, deteksi siklus, dan replay. |
| `web/examples.mjs` | Tiga skenario siap pakai. |
| `web/app.mjs` | Tampilan graf, interaksi, penyimpanan lokal, dan impor/ekspor. |
| `server.mjs` | Server loopback untuk menyajikan aset aplikasi. |
| `tests/` | Tes integrasi alur simulasi dan HTTP. |

Referensi konsep deadlock antar-thread tersedia di [Oracle Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/concurrency/deadlock.html).

## Pengujian

```powershell
npm test
```

Tes mencakup deadlock dua dan tiga thread, pemulihan FIFO, undo dan replay identik, penolakan aksi yang tidak sah, dua siklus terpisah, serta pemeriksaan invariant pada semua state terjangkau dalam preset tiga thread. Tes HTTP memeriksa halaman dan modul yang disajikan oleh server loopback.
