// sync.js - 模拟浏览器发送请求并定时随机调用
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const log4js = require('log4js');
const { runInNewContext } = require('vm');

// 配置log4js
log4js.configure({
    appenders: {
        out: { type: 'stdout' },
        file: { type: 'file', filename: path.join(__dirname, 'logs', 'sync.log') }
    },
    categories: {
        default: { appenders: ['out', 'file'], level: 'debug' }
    }
});

// 创建logger实例
const logger = log4js.getLogger();

const db = new sqlite3.Database(path.join(__dirname, 'kami.db'));

// 确保日志目录存在
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * 模拟浏览器发送请求的方法
 * @param {string} url - 请求URL
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} - 请求结果
 */
async function simulateBrowserRequest(url, options = {}) {
    try {
        // 设置模拟浏览器的默认配置
        const browserOptions = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
                'Connection': 'keep-alive',
                ...options.headers
            },
            timeout: options.timeout || 30000,
            maxRedirects: options.maxRedirects || 5,
            ...options
        };

        logger.info(`开始请求: ${url}`);
        const response = await axios(url, browserOptions);
        logger.info(`请求成功: ${url}, 状态码: ${response.status}`);

        return {
            success: true,
            status: response.status,
            data: response.data,
            headers: response.headers
        };
    } catch (error) {
        logger.error(`请求失败: ${url}, 错误: ${error.message}`);
        return {
            success: false,
            error: error.message,
            url
        };
    }
}

/**
 * 随机获取下次执行的时间间隔（10-30分钟）
 * @returns {number} - 毫秒数
 */
function getRandomInterval() {
    // 最小10分钟，最大30分钟，转换为毫秒
    const minMinutes = 5;
    const maxMinutes = 10;
    const randomMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    return Math.floor(randomMinutes * 60 * 1000);
}

/**
 * 定时随机调用模拟请求方法
 * @param {Array<string>} urls - 要请求的URL列表
 */
async function startAutoSync(urls = []) {
    
    let oldCookieList = await dbAllP(
        'SELECT ac.id,d.domain,ac.account_info accountInfo,ac.cookie_info FROM account_cookies ac left join domain d on ac.domain_id = d.id',
        [], db
    );
    // type 1表示旧版，2表示新版
    const defaultUrls = [
        // {
        //     url: 'http://43.248.188.75:35528/api/account-cookie/list',
        //     type: 1,
        //     remark: 'tls_old'
        // },
        {
            url: 'http://8.140.193.103:3001/api/account-cookie/list',
            type: 1,
            remark: 'lu_old'
        },
        // {
        //     url: 'http://210.16.178.35:28888/api/account-cookie/list',
        //     domainUrl: 'http://210.16.178.35:28888/api/domain/list',
        //     type: 2,
        //     remark: 'tls_new'
        // },
        // {
        //     url: 'http://8.140.193.103:3002/api/account-cookie/list',
        //     domainUrl: 'http://210.16.178.35:28888/api/domain/list',
        //     type: 2,
        //     remark: 'lu_new'
        // },
    ];
    try {
        for (let item of defaultUrls) {
            let url = item.url
            let type = item.type
            let remark = item.remark
            let domainUrl = item.domainUrl
            let domainList = []
            let res = await simulateBrowserRequest(url);
            if (type == 2) {
                let domainRes = await simulateBrowserRequest(domainUrl);
                if (domainRes.success) {
                    logger.info(`请求成功: ${domainUrl}, 状态码: ${domainRes.status}`);
                    logger.debug(`响应数据: ${JSON.stringify(domainRes.data)}`);
                    domainList = domainRes.data.list || []
                    for (let item of res.data.list) {
                        let domainItem = domainList.filter(domainItem => domainItem.id == item.domain_id)[0]
                        item.website_info = domainItem?.domain
                    }
                }
            }

            if (res.success) {
                logger.info(`请求成功: ${url}, 状态码: ${res.status}`);
                logger.debug(`响应数据: ${JSON.stringify(res.data)}`);

                // 检查响应数据中是否有list字段
                if (res.data && res.data.list && Array.isArray(res.data.list)) {
                    logger.info(`开始处理 ${res.data.list.length} 条cookie数据`);
                    const result = await updateOrInsertCookies(res.data.list, type, remark, oldCookieList);
                    logger.info(`数据处理完成`);
                } else {
                    logger.warn('响应数据格式不正确，未包含list数组');
                }
            } else {
                logger.error(`请求失败: ${url}, 错误: ${res.error}`);
            }
        
        }
    } catch (error) {
        logger.error(`同步执行失败: ${error.message}`);
        console.error(error);
    } finally {
        // 获取下一次执行的时间间隔
        const nextInterval = getRandomInterval();
        const nextMinutes = Math.round(nextInterval / 60000);
        logger.info(`下次同步将在 ${nextMinutes} 分钟后执行`);
        // await wait(nextInterval)
        // startAutoSync(defaultUrls)
        // 设置定时器
        setTimeout(() => startAutoSync(defaultUrls), nextInterval);
    }
   
    
}

/**
 * 数据库操作函数：根据domain和account_info更新或插入cookie数据
 * @param {Array} cookiesList - cookie数据列表
 */
async function updateOrInsertCookies(cookiesList, type, remark, oldCookieList) {
    return new Promise(async (resolve, reject) => {
        // 检查要访问的网站是否存在
        for (let newCookieItem of cookiesList) {
            let filterNewDomainList = await dbAllP(
                'SELECT id,domain FROM domain WHERE domain = ?',
                [newCookieItem.website_info], db
            );
            // let filterNewDomainList = oldDomainList.filter(item => item.domain == newCookieItem.website_info)
            let domainId = null
            if (filterNewDomainList.length == 0) {
                // 不存在domain 记录插入domain
                domainId = await dbInsertP(
                    'INSERT INTO domain (domain,name) VALUES (?,?)',
                    [newCookieItem.website_info, newCookieItem.website_info], db
                );
            } else {
                // 存在domain 记录获取domain的id
                domainId = filterNewDomainList[0].id
            }
            newCookieItem.domain_id = domainId
            newCookieItem.account_info = newCookieItem.account_info + "_" + remark
            if (type == 1) {// 旧版cookie需要进行转换
                newCookieItem.cookie_info = convertCookieStringToFullJSON(newCookieItem.cookie_info);
            }

            // 根据domain和account_info判断 旧版cookie中 是否存在
            let filterNewCookieList = oldCookieList.filter(item => item.accountInfo == newCookieItem.account_info&&item.domain_id == newCookieItem.domain_id)
            
            if (filterNewCookieList.length > 0) {
                if(filterNewCookieList[0].cookie_info != newCookieItem.cookie_info){// cookie信息有变化
                    continue
                }
                // 存在 记录更新
                await dbUpdateP(
                    'UPDATE account_cookies SET cookie_info = ? WHERE id = ?',
                    [newCookieItem.cookie_info, filterNewCookieList[0].id], db
                );
             } else {
                // 不存在 记录插入
                cookieId = await dbInsertP(
                    'INSERT INTO account_cookies (domain_id, account_info, cookie_info) VALUES (?, ?, ?)',
                    [newCookieItem.domain_id, newCookieItem.account_info, newCookieItem.cookie_info], db
                );
             }
        }
        resolve()
    });
}


startAutoSync();
 // 立即执行第一次同步
logger.info('启动自动同步服务');

/**
 * 将cookie字符串转换为完整的JSON格式
 */
function convertCookieStringToFullJSON(cookieStr) {
    const result = {
        cookies: [],
        localStorage: {}
    };

    if (!cookieStr || typeof cookieStr !== 'string') {
        return result;
    }

    // 分割cookie字符串
    const cookiePairs = cookieStr.split(';').map(s => s.trim()).filter(Boolean);

    // 默认的localStorage数据
    const defaultLocalStorage = {
        "_uetvid_exp": "Tue, 08 Dec 2026 14:22:50 GMT",
        "_uetsid_exp": "Fri, 14 Nov 2025 14:22:49 GMT",
        "umi_locale": "zh-CN",
        "auth-store": '{"state":{"userInfo":{"uid":10782738,"pid":0,"unionid":"otW1v50wazEUQvmAVxX04fKMPTiA","openid":"o83El6iURmids2_ExA2IwllEN1OA","mc_openid":"","applet_openid":"","username":"FastMoss用户","country":86,"phone":"173****5883","nickname":"FM10782738","email":null,"region":"CN","is_deleted":0,"created_at":1747376424,"created_date":"2025-05-16","level":4,"expire_at":1765382399,"avatar":"https://cdn.500fd.com/public_web/avatar_230724.png","wechat":1,"last_login":"","user_extent":1,"service":{"is_receive_vip":0,"is_send":0},"is_set_password":1,"bypass_type":1,"bypass_total":0,"status":1,"region_name":"中国"},"ext":{"is_login":1},"code":200,"msg":"success"},"version":0}',
        "_uetvid": "3570af70c09c11f08c634d13d216e4cc|efkoid|1763043770499|4|1|bat.bing.com/p/insights/c/b",
        "VISIT_DATA_FOR_VN_ID_TH": '{"count":0,"lastVisit":0}',
        "_uetsid": "3570c070c09c11f0a963abb81373fc47|1joi7dr|2|g0z|0|2143",
        "__g_region": "undefined",
        "li_adsId": "9feb3a59-65cb-4b46-8753-b8b080523a99",
        "Hm_lvt_6ada669245fc6950ae4a2c0a86931766": "1794579762169|1763043759"
    };

    // 为每个cookie名称定义默认属性
    const cookieDefaults = {
        "NEXT_LOCALE": { domain: "www.fastmoss.com", hostOnly: true, sameSite: "lax" },
        "region": { domain: "www.fastmoss.com", hostOnly: true, session: true },
        "fp_visid": { domain: ".fastmoss.com", hostOnly: false },
        "userTimeZone": { domain: ".fastmoss.com", hostOnly: false },
        "Hm_lvt_6ada669245fc6950ae4a2c0a86931766": { domain: ".fastmoss.com", hostOnly: false },
        "HMACCOUNT": { domain: ".fastmoss.com", hostOnly: false, session: true },
        "_clck": { domain: ".fastmoss.com", hostOnly: false },
        "Hm_lpvt_6ada669245fc6950ae4a2c0a86931766": { domain: ".fastmoss.com", hostOnly: false, session: true },
        "_clsk": { domain: ".fastmoss.com", hostOnly: false, expirationDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) },
        "_uetsid": { domain: ".www.fastmoss.com", hostOnly: false, expirationDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) },
        "_uetvid": { domain: ".www.fastmoss.com", hostOnly: false, expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) },
        "fd_tk": { domain: ".www.fastmoss.com", hostOnly: false, session: true }
    };

    cookiePairs.forEach(pair => {
        const equalIndex = pair.indexOf('=');
        if (equalIndex === -1) return;

        const name = pair.substring(0, equalIndex).trim();
        const value = pair.substring(equalIndex + 1).trim();

        if (name && value) {
            const defaults = cookieDefaults[name] || {};

            result.cookies.push({
                domain: defaults.domain || ".fastmoss.com",
                expirationDate: defaults.expirationDate || (Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)),
                hostOnly: defaults.hostOnly !== undefined ? defaults.hostOnly : false,
                httpOnly: false,
                name: name,
                path: "/",
                sameSite: defaults.sameSite || "unspecified",
                secure: false,
                session: defaults.session || false,
                storeId: "0",
                value: value
            });
        }
    });

    // 添加默认的localStorage数据
    result.localStorage = defaultLocalStorage;

    return JSON.stringify(result);
}

function dbAllP(sql, params, db) {
    logger.debug('SQL查询:', sql);
    logger.debug('参数:', params);
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

function dbGetP(sql, params, db) {
    logger.debug('SQL查询:', sql);
    logger.debug('参数:', params);
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function dbInsertP(sql, params, db) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
}

function dbUpdateP(sql, params, db) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
}

// 创建一个可重用的延迟函数，返回Promise
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}