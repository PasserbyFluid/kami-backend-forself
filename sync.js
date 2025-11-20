// // sync.js - 模拟浏览器发送请求并定时随机调用
// const axios = require('axios');
// const fs = require('fs');
// const path = require('path');
// const sqlite3 = require('sqlite3').verbose();



// // 日志函数
// function log(message) {
//     const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
//     const logMessage = `[${timestamp}] ${message}`;
//     console.log(logMessage);

//     // 写入日志文件
//     const logFile = path.join(__dirname, 'sync.log');
//     fs.appendFileSync(logFile, logMessage + '\n', 'utf8');
// }

// /**
//  * 模拟浏览器发送请求的方法
//  * @param {string} url - 请求URL
//  * @param {Object} options - 请求选项
//  * @returns {Promise<Object>} - 请求结果
//  */
// async function simulateBrowserRequest(url, options = {}) {
//     try {
//         // 设置模拟浏览器的默认配置
//         const browserOptions = {
//             headers: {
//                 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
//                 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
//                 'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
//                 'Connection': 'keep-alive',
//                 ...options.headers
//             },
//             timeout: options.timeout || 30000,
//             maxRedirects: options.maxRedirects || 5,
//             ...options
//         };

//         log(`开始请求: ${url}`);
//         const response = await axios(url, browserOptions);
//         log(`请求成功: ${url}, 状态码: ${response.status}`);

//         return {
//             success: true,
//             status: response.status,
//             data: response.data,
//             headers: response.headers
//         };
//     } catch (error) {
//         log(`请求失败: ${url}, 错误: ${error.message}`);
//         return {
//             success: false,
//             error: error.message,
//             url
//         };
//     }
// }

// /**
//  * 随机获取下次执行的时间间隔（10-30分钟）
//  * @returns {number} - 毫秒数
//  */
function getRandomInterval() {
    // 最小10分钟，最大30分钟，转换为毫秒
    const minMinutes = 0.1;
    const maxMinutes = 0.5;
    const randomMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    return Math.floor(randomMinutes * 60 * 1000);
}

// /**
//  * 定时随机调用模拟请求方法
//  * @param {Array<string>} urls - 要请求的URL列表
//  */
// async function startAutoSync(urls = []) {
//     // type 1表示旧版，2表示新版
//     const defaultUrls = [
//         {
//             url: 'http://43.248.188.75:35528/api/account-cookie/list',
//             type: 1,
//             remark: 'tls_old'
//         },
//         {
//             url: 'http://8.140.193.103:3001/api/account-cookie/list',
//             type: 1,
//             remark: 'lu_old'
//         },
//         {
//             url: 'http://210.16.178.35:28888/api/account-cookie/list',
//             type: 2,
//             remark: 'tls_new'
//         },
//         {
//             url: 'http://8.140.193.103:3002/api/account-cookie/list',
//             type: 2,
//             remark: 'lu_new'
//         },
//     ];

//     for (let item of defaultUrls) {
//         let url = item.url
//         let type = item.type
//         let remark = item.remark
//         let res = await simulateBrowserRequest(randomUrl);
//     }

//     // 立即执行第一次同步
//     log('启动自动同步服务');
//     executeSync();
// }

// /**
//  * 数据库操作函数：根据domain和account_info更新或插入cookie数据
//  * @param {Array} cookiesList - cookie数据列表
//  */
// async function updateOrInsertCookies(cookiesList) {
//     return new Promise((resolve, reject) => {
//         const db = new sqlite3.Database(path.join(__dirname, 'kami.db'));
//         let updatedCount = 0;
//         let insertedCount = 0;

//         // 逐个处理cookie数据
//         const processNext = async (index) => {
//             if (index >= cookiesList.length) {
//                 db.close();
//                 resolve({ updated: updatedCount, inserted: insertedCount });
//                 return;
//             }

//             const cookieItem = cookiesList[index];

//             let cookieInfo = test(cookieItem);
//             console.log(cookieInfo)


//             const { domain, cookie, account_info } = cookieInfo;


//             const row = await dbGetP(
//                 'SELECT id FROM domain WHERE domain = ?',
//                 [domain], db
//             );
//             let domainId = null;
//             if (row) {
//                 // 存在domain 记录获取domain的id
//                 domainId = row.id;
//             } else {
//                 // 不存在domain 记录插入domain
//                 domainId = await dbInsertP(
//                     'INSERT INTO domain (domain) VALUES (?)',
//                     [domain], db
//                 );
//             }
//             const accountInfo = await dbGetP(
//                 'SELECT id FROM account_cookies WHERE domain_id = ? AND account_info = ?',
//                 [domainId, account_info], db
//             );
//             let accountId = null;
//             if (accountInfo) {
//                 // 存在account_info 记录获取account_info的id
//                 accountId = accountInfo.id;
//                 await dbUpdateP(
//                     'UPDATE account_cookies SET cookie = ?,account_info = ? WHERE id = ?',
//                     [cookie, account_info, accountId], db
//                 );
//             } else {
//                 // 不存在account_info 记录插入account_info
//                 accountId = await dbInsertP(
//                     'INSERT INTO account_cookies (domain_id,account_info,cookie_info) VALUES (?,?,?)',
//                     [domainId, account_info, cookie], db
//                 );
//             }
//             processNext(index + 1);
//         };
//         // 开始处理第一个数据项
//         processNext(0);
//     });
// }

// async function executeSync() {
//     try {
//         // 随机选择一个URL进行请求
//         const randomUrl = "http://8.140.193.103:3001/api/account-cookie/list";
//         // const randomUrl = "http://127.0.0.1:18888/api/account-cookie/list";
//         let res = await simulateBrowserRequest(randomUrl);

//         if (res.success) {
//             log(`请求成功: ${randomUrl}, 状态码: ${res.status}`);
//             log(`响应数据: ${JSON.stringify(res.data)}`);

//             // 检查响应数据中是否有list字段
//             if (res.data && res.data.list && Array.isArray(res.data.list)) {
//                 log(`开始处理 ${res.data.list.length} 条cookie数据`);
//                 const result = await updateOrInsertCookies(res.data.list);
//                 log(`数据处理完成: 更新 ${result.updated} 条, 插入 ${result.inserted} 条`);
//             } else {
//                 log('响应数据格式不正确，未包含list数组');
//             }
//         } else {
//             log(`请求失败: ${randomUrl}, 错误: ${res.error}`);
//         }
//     } catch (error) {
//         log(`同步执行失败: ${error.message}`);
//         console.error(error);
//     } finally {
//         // 获取下一次执行的时间间隔
//         const nextInterval = getRandomInterval();
//         const nextMinutes = Math.round(nextInterval / 60000);
//         log(`下次同步将在 ${nextMinutes} 分钟后执行`);

//         // 设置定时器
//         setTimeout(executeSync, nextInterval);
//     }
// }

// executeSync();
// // 如果直接运行该文件，启动自动同步
// //if (require.main === module) {
// // executeSync();

// //}

// function test(item) {
//     try {
//         JSON.parse(item.cookie_info);
//         return {
//             domain: item.website_info,
//             cookie: item.cookie_info,
//             account_info: item.account_info,
//         }
//     } catch (error) {
//         // console.log(`cookie解析失败: ${item.cookie}, 错误: ${error.message}`);
//         // 按照新格式转json
//         let cookieStr = item.cookie_info;
//         console.log(cookieStr);
//         let cookieJson = {};
//         let cookiePairs = cookieStr.split(';');
//         for (let j = 0; j < cookiePairs.length; j++) {
//             let pair = cookiePairs[j].trim();
//             let keyValue = pair.split('=');
//             if (keyValue.length === 2) {
//                 cookieJson[keyValue[0]] = keyValue[1];
//             }
//         }
//         item.cookie = JSON.stringify({ "cookies": [cookieJson] });
//         item.domain = item.website_info
//         return {
//             domain: item.website_info,
//             cookie: JSON.stringify({ "cookies": [cookieJson] }),
//             account_info: item.account_info,
//         }
//     }
// }


// function dbGetP(sql, params, db) {
//     console.log(sql)
//     console.log(params)
//     return new Promise((resolve, reject) => {
//         db.get(sql, params, (err, row) => {
//             if (err) {
//                 reject(err);
//             } else {
//                 resolve(row);
//             }
//         });
//     });
// }

// function dbInsertP(sql, params, db) {
//     return new Promise((resolve, reject) => {
//         db.run(sql, params, function (err) {
//             if (err) {
//                 reject(err);
//             } else {
//                 resolve(this.lastID);
//             }
//         });
//     });
// }

// function dbUpdateP(sql, params, db) {
//     return new Promise((resolve, reject) => {
//         db.run(sql, params, function (err) {
//             if (err) {
//                 reject(err);
//             } else {
//                 resolve(this.changes);
//             }
//         });
//     });
// }
async function test() {
    console.log("waibu "+Date.now())
    // 修改为固定的1秒延迟，方便测试
    setTimeout(() => {
        test()
    }, 1000);
}
test()