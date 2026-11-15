# VoxPulse SIP - Dokploy Deployment Guide (GitHub)

এই অ্যাপ্লিকেশনটি **Dokploy** (বা Coolify / Docker PaaS)-এ GitHub-এর মাধ্যমে ডিপ্লয় করার জন্য সম্পূর্ণ প্রস্তুত করা হয়েছে।

---

## ১. গিটহাব রিপোজিটরিতে কোড পুশ করা (Push to GitHub)

আপনার লোকাল কম্পিউটারে টার্মিনাল বা Git Bash ওপেন করে প্রজেক্ট ফোল্ডারে নিচের কমান্ডগুলো চালান:

```bash
# গিট ইনিশিয়ালাইজ করুন (যদি আগে না করা থাকে)
git init

# সব ফাইল স্টেজ করুন
git add .

# কমিট করুন
git commit -m "Initial commit for Dokploy deployment"

# মেইন ব্রাঞ্চ সেট করুন
git branch -M main

# আপনার গিটহাব রিপোজিটরি লিংক দিন
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPOSITORY_NAME>.git

# পুশ করুন
git push -u origin main
```

---

## ২. Dokploy-তে অ্যাপ্লিকেশন তৈরি ও কনফিগারেশন

Dokploy ড্যাশবোর্ডে লগইন করুন এবং নিচের ধাপগুলো অনুসরণ করুন:

1. **Create Application**:
   * Dokploy ড্যাশবোর্ডে গিয়ে **Applications** -> **Create Application**-এ ক্লিক করুন।
   * নাম দিন: `CallCenter` বা `VoxPulse-SIP`।

2. **Source Code (GitHub Provider)**:
   * **Provider** হিসেবে **GitHub** সিলেক্ট করুন।
   * আপনার GitHub একাউন্ট থেকে রিপোজিটরি (`<YOUR_REPOSITORY_NAME>`) এবং ব্রাঞ্চ (`main`) সিলেক্ট করুন।
   * **Auto Deploy**: চালু রাখুন (যাতে পরবর্তীতে গিটহাবে কোনো পুশ দিলে Dokploy নিজে নিজে অটো-বিল্ড করে নেয়)।

3. **Build Type**:
   * Build Type হিসেবে **`Dockerfile`** সিলেক্ট করুন।
   * Dockerfile Path: `/Dockerfile` (ডিফল্ট)।
   * *(বিকল্প: আপনি চাইলে **Nixpacks** ও সিলেক্ট করতে পারেন, প্রজেক্টে দুটিই সাপোর্ট করে)*।

4. **Network & Port**:
   * **Container Port**: `3000` দিন।
   * *(Dokploy-র Traefik স্বয়ংক্রিয়ভাবে বাইরের ডোমেইন থেকে এই ৩০০০ পোর্টে ট্রাফিক পাঠাবে)*।

5. **Domains & SSL**:
   * **Domains** ট্যাবে যান এবং **Add Domain**-এ ক্লিক করুন।
   * আপনার ডোমেইন দিন: উদাহরণস্বরূপ `callcenter.softneed.link`।
   * **Certificate**: `Let's Encrypt` সিলেক্ট করুন (Dokploy অটোমেটিক ফ্রি SSL সার্টিফিকেট ইনস্টল করে দিবে)।

6. **Environment Variables (ঐচ্ছিক)**:
   * প্রজেক্টে ইতিমধ্যে প্রোডাকশন ডিফল্ট ও ফায়ারবেস কনফিগারেশন এম্বেড করা আছে।
   * যদি প্রয়োজন হয়, `Environment` ট্যাবে যোগ করতে পারেন:
     ```env
     NODE_ENV=production
     PORT=3000
     ```

7. **Deploy**:
   * উপরে থাকা **"Deploy"** বাটনে ক্লিক করুন।
   * Dokploy গিটহাব থেকে কোড ক্লোন করবে, ডকার ইমেজ বিল্ড করবে এবং মাত্র ১-২ মিনিটের মধ্যে লাইভ করে দিবে!

---

## ৩. হেলথ চেক ও ভেরিফিকেশন (Health Check)

* **Healthcheck Endpoint**: `http://localhost:3000/api/health`
* Dokploy বিল্ট-ইন হেলথচেক দিয়ে স্বয়ংক্রিয়ভাবে নিশ্চিত করবে যে কন্টেইনার অনলাইনে আছে।

---

## ৪. অ্যাডমিন লগইন ক্রেডেনশিয়াল

সাইট লাইভ হওয়ার পর লগইন করার জন্য:
* **Email**: `ksahrn.com@gmail.com`
* **Password**: `Admin#2026`
