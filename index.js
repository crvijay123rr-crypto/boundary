const express = require('express'); 
const http = require('http'); 
const fs = require('fs'); 
const { Telegraf, Markup } = require('telegraf'); 

const app = express(); 
const PORT = process.env.PORT || 10000; // Heroku के डायनामिक पोर्ट के लिए 

// 🌟 1. टोकन वेरिफिकेशन 
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
if (!BOT_TOKEN) { 
    console.error("[-] ERROR: TELEGRAM_BOT_TOKEN Environment Variable is missing!"); 
    process.exit(1); 
} 

const bot = new Telegraf(BOT_TOKEN); 
const userStates = {}; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms)); 

// ================================================================= 
// 🔬 2. क्लास बाउंड्री कोर इंजन (Regex संचालित - नो चेरियो) 
// ================================================================= 
async function getOldSchoolCodeSafe(roll, cls, year) { 
    return new Promise((resolve) => { 
        const examCode = cls === '10' ? 'SEC_MAIN' : 'SRS_MAIN'; 
        const postData = `cmb_year=${year}&cmb_exam=${examCode}&txt_roll=${roll}&b1=Submit`; 
        const req = http.request({ 
            hostname: 'verification.bserajmer.in', 
            port: 8081, 
            path: '/oldresult/view_TR.asp', 
            method: 'POST', 
            family: 4, 
            headers: { 
                'Host': 'verification.bserajmer.in:8081', 
                'Content-Type': 'application/x-www-form-urlencoded', 
                'Content-Length': Buffer.byteLength(postData), 
                'User-Agent': 'Mozilla/5.0', 
                'Referer': 'http://bserajmer.in' 
            }, 
            timeout: 5000 
        }, (res) => { 
            let data = ''; 
            res.setEncoding('utf8'); 
            res.on('data', chunk => data += chunk); 
            res.on('end', () => { 
                const html = data; 
                if (!html.includes("NAME OF CANDIDATE")) return resolve(null); 
                try { 
                    const regexPattern = new RegExp(`<td[^>]*>([\\s\\S]*?)<\\/td>\\s*<td[^>]*>\\s*${roll}\\s*<\\/td>`, 'i'); 
                    const match = html.match(regexPattern); 
                    if (match && match[1]) { 
                        return resolve(match[1].replace(/<[^>]*>/g, '').trim() || null); 
                    } 
                    resolve(null); 
                } catch(e) { 
                    resolve(null); 
                } 
            }); 
        }); 
        req.on('error', () => resolve(null)); 
        req.on('timeout', () => { 
            req.destroy(); 
            resolve(null); 
        }); 
        req.write(postData); 
        req.end(); 
    }); 
} 

async function getNewSchoolName(roll, cls, year, stream) { 
    let targetUrl = ""; 
    if (cls === "10") { 
        targetUrl = `https://indiaresults.com/${year}/mrollresult.asp`; 
    } else if (cls === "12") { 
        if (stream === "science") targetUrl = `https://indiaresults.com/${year}/mrollresult.asp`; 
        else if (stream === "arts") targetUrl = `https://indiaresults.com/${year}/mrollresult.asp`; 
        else if (stream === "commerce") targetUrl = `https://indiaresults.com/${year}/mrollresult.aspx`; 
    } 
    try { 
        const response = await fetch(targetUrl, { 
            method: "POST", 
            headers: { 
                "Content-Type": "application/x-www-form-urlencoded", 
                "User-Agent": "Mozilla/5.0" 
            }, 
            body: `rollno=${roll}`, 
            signal: AbortSignal.timeout(5000) 
        }); 
        if (!response.ok) return null; 
        const html = await response.text(); 
        const schoolRegex = /(?:SCHOOL|SCH|CENTRE|COLLEGE)[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i; 
        const match = html.match(schoolRegex); 
        if (match && match[1]) { 
            return match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); 
        } 
        return null; 
    } catch (e) { 
        return null; 
    } 
} 

async function mapSchoolBoundaries(seedRollStr, cls, year, stream) { 
    const startRollInt = parseInt(seedRollStr, 10); 
    if (isNaN(startRollInt)) return { success: false, error: "अमान्य रोल नंबर।" }; 
    const isOldArchive = (year !== '2026'); 
    
    const targetIdentifier = isOldArchive ? await getOldSchoolCodeSafe(startRollInt, cls, year) : await getNewSchoolName(startRollInt, cls, year, stream); 
    if (!targetIdentifier) return { success: false, error: "इस बेस रोल नंबर का डेटा नहीं मिल सका।" }; 
    
    let startRoll = startRollInt; 
    let endRoll = startRollInt; 
    const batchSize = isOldArchive ? 5 : 10; 

    // Backward Search Loop 
    let checkingBackward = true; 
    while (checkingBackward) { 
        let currentBatch = []; 
        for (let i = 1; i <= batchSize; i++) currentBatch.push(startRoll - i); 
        let results = await Promise.all(currentBatch.map(roll => isOldArchive ? getOldSchoolCodeSafe(roll, cls, year) : getNewSchoolName(roll, cls, year, stream) )); 
        
        if (isOldArchive) await delay(1000); 
        else await delay(300); 
        
        let boundaryFoundInBatch = false; 
        for (let i = 0; i < results.length; i++) { 
            if (results[i] !== targetIdentifier) { 
                startRoll = currentBatch[i] + 1; 
                checkingBackward = false; 
                boundaryFoundInBatch = true; 
                break; 
            } 
        } 
        if (!boundaryFoundInBatch) startRoll -= batchSize; 
    } 

    // Forward Search Loop 
    let checkingForward = true; 
    while (checkingForward) { 
        let currentBatch = []; 
        for (let i = 1; i <= batchSize; i++) currentBatch.push(endRoll + i); 
        let results = await Promise.all(currentBatch.map(roll => isOldArchive ? getOldSchoolCodeSafe(roll, cls, year) : getNewSchoolName(roll, cls, year, stream) )); 
        
        if (isOldArchive) await delay(1000); 
        else await delay(300); 
        
        let boundaryFoundInBatch = false; 
        for (let i = 0; i < results.length; i++) { 
            if (results[i] !== targetIdentifier) { 
                endRoll = currentBatch[i] - 1; 
                checkingForward = false; 
                boundaryFoundInBatch = true; 
                break; 
            } 
        } 
        if (!boundaryFoundInBatch) endRoll += batchSize; 
    } 
    return { success: true, schoolName: targetIdentifier, startRoll, endRoll, totalStudents: (endRoll - startRoll) + 1 }; 
} 

// ================================================================= 
// 📦 3. साल 2014 से 2026 तक का फिक्स रोल नंबर डेटाबेस (Seed Data) 
// ================================================================= 
const rbseDatabase = { 
    "10": { 
        "2026": { stream: "general", seed: "1563225" }, 
        "2025": { stream: "general", seed: "1554102" }, 
        "2024": { stream: "general", seed: "1510405" }, 
        "2023": { stream: "general", seed: "1620150" }, 
        "2022": { stream: "general", seed: "1589410" }, 
        "2021": { stream: "general", seed: "1501452" }, 
        "2014": { stream: "general", seed: "1005214" } 
    }, 
    "12": { 
        "2026": [{ stream: "science", seed: "2618890" }, { stream: "commerce", seed: "2803775" }, { stream: "arts", seed: "3166021" }], 
        "2025": [{ stream: "science", seed: "2605140" }, { stream: "commerce", seed: "2801450" }, { stream: "arts", seed: "3110250" }], 
        "2024": [{ stream: "science", seed: "2589410" }, { stream: "commerce", seed: "2794100" }, { stream: "arts", seed: "3051420" }], 
        "2023": [{ stream: "science", seed: "2501420" }, { stream: "commerce", seed: "2751420" }, { stream: "arts", seed: "3001420" }] 
    } 
}; 

function getSeedData(cls, year) { 
    if (rbseDatabase[cls] && rbseDatabase[cls][year]) return rbseDatabase[cls][year]; 
    return cls === "10" ? { stream: "general", seed: "1501001" } : [{ stream: "science", seed: "2501001" }, { stream: "commerce", seed: "2801001" }, { stream: "arts", seed: "3001001" }]; 
} 

// ================================================================= 
// 🎛️ 4. टेलीग्राम इनलाइन कीबोर्ड UI इंटरफ़ेस 
// ================================================================= 
bot.start((ctx) => { 
    userStates[ctx.from.id] = {}; 
    ctx.reply("👋 *RBSE क्लास बाउंड्री रडार बॉट*\n\n📌 कृपया पहले *कक्षा (Class)* चुनें:", { 
        parse_mode: 'Markdown', 
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🏫 10th (Secondary)', 'select_class_10')], 
            [Markup.button.callback('🎓 12th (Senior Secondary)', 'select_class_12')]
        ]) 
    }); 
}); 

bot.action(/select_class_(10|12)/, (ctx) => { 
    userStates[ctx.from.id].class = ctx.match[1]; 
    ctx.editMessageText("📅 अब परीक्षा का *वर्ष (Year)* चुनें:", Markup.inlineKeyboard([ 
        [Markup.button.callback('2026', 'select_year_2026'), Markup.button.callback('2025', 'select_year_2025'), Markup.button.callback('2024', 'select_year_2024')], 
        [Markup.button.callback('2023', 'select_year_2023'), Markup.button.callback('2022', 'select_year_2022'), Markup.button.callback('2021', 'select_year_2021')], 
        [Markup.button.callback('2020', 'select_year_2020'), Markup.button.callback('2019', 'select_year_2019'), Markup.button.callback('2018', 'select_year_2018')], 
        [Markup.button.callback('🔙 कक्षा बदलें', 'back_to_class')] 
    ])); 
}); 

bot.action(/select_year_(\d+)/, (ctx) => { 
    const userId = ctx.from.id; 
    userStates[userId].year = ctx.match[1]; 
    ctx.editMessageText(`🚀 *सेटअप पूरा हुआ!*\n\n📋 *विवरण:*\n🔹 कक्षा: ${userStates[userId].class}th\n🔹 वर्ष: ${userStates[userId].year}\n\n⚙️ रिज़ल्ट इसी चैट बॉक्स में भेजा जाएगा। क्या सर्च शुरू करें?`, { 
        parse_mode: 'Markdown', 
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⚡ हाँ, सर्च शुरू करें!', 'launch_search')], 
            [Markup.button.callback('❌ रद्द करें', 'back_to_class')]
        ]) 
    }); 
}); 

bot.action('back_to_class', (ctx) => { 
    userStates[ctx.from.id] = {}; 
    ctx.editMessageText("📌 कृपया कक्षा चुनें:", Markup.inlineKeyboard([
        [Markup.button.callback('🏫 10th (Secondary)', 'select_class_10')], 
        [Markup.button.callback('🎓 12th (Senior Secondary)', 'select_class_12')]
    ])); 
}); 

bot.action('launch_search', async (ctx) => { 
    const userId = ctx.from.id; 
    const { class: cls, year } = userStates[userId]; 
    if (!cls || !year) return ctx.reply("❌ सत्र एक्सपायर हो गया है। दोबारा /start करें।"); 

    ctx.editMessageText(`⏳ वर्ष ${year} की कक्षा ${cls}th की क्लास बाउंड्री सर्च बैकग्राउंड में शुरू हो गई है...`); 
    executeDirectChatMining(cls, year, ctx.chat.id); 
}); 

async function executeDirectChatMining(cls, year, chatId) { 
    try { 
        const seedData = getSeedData(cls, year); 
        const targets = Array.isArray(seedData) ? seedData : [seedData]; 
        bot.telegram.sendMessage(chatId, `🚩 *माइनिंग इंजन एक्टिवेटेड:* वर्ष ${year} | क्लास: ${cls}th\n⏳ कृपया प्रतीक्षा करें...`, { parse_mode: 'Markdown' }); 

        for (const target of targets) { 
            const report = await mapSchoolBoundaries(target.seed, cls, year, target.stream); 
            if (report.success) { 
                const caption = `✅ *क्लास बाउंड्री रिपोर्ट लॉक*\n\n📅 वर्ष: ${year}\n🏫 कक्षा: ${cls}th\n🧪 संकाय/सत्र: ${target.stream.toUpperCase()}\n🔢 रोल रेंज: ${report.startRoll} - ${report.endRoll}\n📊 कुल छात्र: ${report.totalStudents}`; 

                const tempFile = `./RBSE_${year}_Class_${cls}_${target.stream}.json`; 
                fs.writeFileSync(tempFile, JSON.stringify(report, null, 2)); 

                await bot.telegram.sendDocument(chatId, { source: tempFile, filename: `RBSE_${year}_Class_${cls}_${target.stream}.json` }, { caption: caption, parse_mode: 'Markdown' }); 
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); 
            } else { 
                bot.telegram.sendMessage(chatId, `❌ त्रुटि (${target.stream}): ${report.error}`); 
            } 
            await new Promise(res => setTimeout(res, 2000)); 
        } 
        bot.telegram.sendMessage(chatId, `🏁 *सभी रिज़ल्ट सफलतापूर्वक भेज दिए गए हैं!*`, { parse_mode: 'Markdown' }); 
    } catch (err) { 
        bot.telegram.sendMessage(chatId, `⚠️ क्रिटिकल एरर: ${err.message}`); 
    } 
} 

// ================================================================= 
// 🌐 5. एक्सप्रेस सर्वर (Heroku को क्रैश होने से बचाने के लिए)
// ================================================================= 
app.get('/', (req, res) => res.send('RBSE Radar Bot is Live on Heroku!')); 

app.listen(PORT, '0.0.0.0', () => { 
    console.log(`[🌐] Server successfully listening on port ${PORT}`); 
    bot.launch().then(() => console.log("[🤖] Telegram Bot status: ACTIVE")).catch(e => console.error(e)); 
}); 
                                                                                                         
