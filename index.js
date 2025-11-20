const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const log4js = require('log4js');
const schedule = require('node-schedule');
const { log } = require('console');

// 创建日志目录 - 使用绝对路径
const logsDir = path.resolve(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  console.log(`创建日志目录: ${logsDir}`); // 使用console确保启动时能看到
}

// 创建备份目录 - Windows系统使用D盘而不是/var/backup
const backupDir = process.platform === 'win32' ? 'D:\\backup' : '/var/backup';
if (!fs.existsSync(backupDir)) {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`创建备份目录: ${backupDir}`); // 使用console确保启动时能看到
  } catch (err) {
    console.error(`创建备份目录失败: ${err.message}`);
  }
}

// log4js配置 - 使用绝对路径以支持pm2环境
log4js.configure({
  pm2: true, // 这是日志大坑
  appenders: {
    console: { type: 'console' },
    file: {
      type: 'file',
      filename: path.resolve(__dirname, 'logs', 'kami-backend.log'),
      maxLogSize: 10485760, // 10MB
      backups: 5,
      layout: {
        type: 'pattern',
        pattern: '%d{yyyy-MM-dd HH:mm:ss} [%p] %c - %m%n'
      }
    }
  },
  categories: {
    default: { appenders: ['console', 'file'], level: 'info' }
  }
});

const logger = log4js.getLogger();

const app = express();
const PORT = 29477;



// 解析JSON请求体
app.use(express.json());

// 在 app.use(express.json()) 后添加
app.use(session({
  secret: 'your_secret_key', // 建议更换为复杂随机字符串
  resave: false,
  saveUninitialized: true
}));

// 登录页渲染
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 登录处理
app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body;
  const clientIP = req.ip;
  db.get('SELECT pwd FROM admin_pwd WHERE id=1', (err, row) => {
    if (err) {
      logger.error('登录验证数据库查询失败:', err.message);
      return res.send('<script>alert("系统错误，请重试");location.href="/login"</script>');
    }
    if (row && password === row.pwd) {
      req.session.auth = true;
      logger.info(`登录成功 - IP: ${clientIP}`);
      // 检测是否为移动设备
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(req.headers['user-agent']);
      res.redirect(isMobile ? '/mobile.html' : '/index.html');
    } else {
      logger.warn(`登录失败 - IP: ${clientIP}, 密码错误`);
      res.send('<script>alert("密码错误");location.href="/login"</script>');
    }
  });
});
// 鉴权中间件
function authMiddleware(req, res, next) {
  // 只保护 index.html 和 cookie.html
  const protectedPages = ['/', '/index.html', '/cookie.html', '/domain.html', '/account-cookie.html', '/kami-cookie.html', '/selector.html'];
  if (protectedPages.includes(req.path)) {
    if (req.session && req.session.auth) {
      return next();
    } else {
      return res.redirect('/login');
    }
  }
  next();
}
/*
// 鉴权中间件
function authMiddleware(req, res, next) {
  // 除登录路径外，其他所有请求都需要鉴权
  const loginPath = '/login';
  if (req.path !== loginPath && !req.path.startsWith('/css/')) {
    if (req.session && req.session.auth) {
      return next();
    } else {
      return res.redirect('/login');
    }
  }
  next();
}

*/
// 在静态资源服务前添加
app.use(authMiddleware);

// 数据库文件路径
const dbPath = path.join(__dirname, 'kami.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('数据库连接失败:', err.message);
  } else {
    logger.info('已连接到SQLite数据库');
  }
});

// 添加SQL及参数打印功能
db.on('trace', (sql) => {
  logger.info(`SQL执行: ${sql}`);
});

// 为主要数据库方法添加日志包装
const originalAll = db.all.bind(db);
db.all = function(sql, params, callback) {
  logger.info(`SQL查询: ${sql}`, params ? `, 参数: ${JSON.stringify(params)}` : '');
  return originalAll(sql, params, callback);
};

const originalGet = db.get.bind(db);
db.get = function(sql, params, callback) {
  logger.info(`SQL查询(get): ${sql}`, params ? `, 参数: ${JSON.stringify(params)}` : '');
  return originalGet(sql, params, callback);
};

const originalRun = db.run.bind(db);
db.run = function(sql, params, callback) {
  logger.info(`SQL执行(run): ${sql}`, params ? `, 参数: ${JSON.stringify(params)}` : '');
  return originalRun(sql, params, callback);
};

// 初始化卡密表
const initSql = `
CREATE TABLE IF NOT EXISTS kami (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  activated_at DATETIME,
  expire_at DATETIME,
  machine TEXT,
  machine_num INTEGER DEFAULT 1,
  machine_band_num INTEGER DEFAULT 0,
  disabled INTEGER DEFAULT 0,
  period TEXT,
  remarks TEXT
);
`;
db.run(initSql, (err) => {
  if (err) {
    logger.error('初始化表失败:', err.message);
  } else {
    logger.info('卡密表已准备好');
  }
});


// 初始化账号与cookie关系表
const initAccountCookieSql = `
CREATE TABLE IF NOT EXISTS account_cookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  account_info TEXT NOT NULL,
  cookie_info TEXT,
  website_info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.run(initAccountCookieSql, (err) => {
  if (err) {
    logger.error('初始化账号与cookie关系表失败:', err.message);
  } else {
    logger.info('账号与cookie关系表已准备好');
  }
});

// 初始化kami与cookie关系表
const initKamiCookieSql = `
CREATE TABLE IF NOT EXISTS kami_cookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kami_code TEXT NOT NULL,
  cookie_id INTEGER NOT NULL,
  active_at DATETIME,
  active_state INTEGER DEFAULT 0,
  duration_type TEXT DEFAULT 'h',
  duration INTEGER DEFAULT 0,
  expire_at DATETIME,
  disabled INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.run(initKamiCookieSql, (err) => {
  if (err) {
    logger.error('初始化kami与cookie关系表失败:', err.message);
  } else {
    logger.info('kami与cookie关系表已准备好');
  }
});

// 初始化公告表
const initNoticeSql = `
CREATE TABLE IF NOT EXISTS notice (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT
);
`;
db.run(initNoticeSql, (err) => {
  if (err) {
    logger.error('初始化公告表失败:', err.message);
  } else {
    logger.info('公告表已准备好');
  }
});

// 初始化管理员密码表
const initPwdSql = `
CREATE TABLE IF NOT EXISTS admin_pwd (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pwd TEXT NOT NULL
);
`;
db.run(initPwdSql, (err) => {
  if (err) logger.error('初始化密码表失败:', err.message);
  else {
    db.get('SELECT * FROM admin_pwd WHERE id=1', (err, row) => {
      if (!row) {
        db.run('INSERT INTO admin_pwd (id, pwd) VALUES (1, ?)', ['123456']);
      }
    });
  }
});

// 初始化域名表
const initDomainSql = `
CREATE TABLE IF NOT EXISTS domain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT '1',
  name TEXT NOT NULL DEFAULT '1',
  pluginId TEXT DEFAULT '1',
  notifyContent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.run(initDomainSql, (err) => {
  if (err) {
    logger.error('初始化域名表失败:', err.message);
  } else {
    logger.info('域名表已准备好');
  }
});

// 初始化选择器表
const initSelectorSql = `
CREATE TABLE IF NOT EXISTS selector (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  selector TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.run(initSelectorSql, (err) => {
  if (err) {
    logger.error('初始化选择器表失败:', err.message);
  } else {
    logger.info('选择器表已准备好');
  }
});

// 初始化卡密机器码表
const initMachineSql = `
CREATE TABLE IF NOT EXISTS machine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine TEXT NOT NULL,
  kami_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.run(initMachineSql, (err) => {
  if (err) {
    logger.error('初始化卡密机器码表失败:', err.message);
  } else {
    logger.info('卡密机器码表已准备好');
  }
});

// 获取域名列表接口
app.get('/api/domain/list', (req, res) => {
  db.all('SELECT id, domain, type, name, pluginId, notifyContent, created_at FROM domain ORDER BY id DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '数据库查询失败' });
    }
    res.json({ list: rows });
  });
});

// 添加域名接口
app.post('/api/domain/add', (req, res) => {
  const { domain, type, name, pluginId, notifyContent } = req.body;
  if (!domain || !type || !name) {
    return res.status(400).json({ error: '域名、类型和名称不能为空', success: false });
  }

  // 验证类型是否有效
  const validTypes = ['1', '2', '3'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: '无效的类型', success: false });
  }

  const beijingNow = getBeijingTimeStr();
  db.run('INSERT INTO domain (domain, type, name, pluginId, notifyContent, created_at) VALUES (?, ?, ?, ?, ?, ?)', [domain, type, name, pluginId || '', notifyContent || '', beijingNow], function (err) {
    if (err) {
      if (err.errno === 19) { // SQLite UNIQUE constraint violation
        return res.status(400).json({ error: '该域名已存在', success: false });
      }
      logger.error('错误:', err.message || err);
      return res.status(500).json({ error: '添加失败', success: false });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// 更新域名接口
app.post('/api/domain/update', (req, res) => {
  const { id, domain, type, name, pluginId, notifyContent } = req.body;
  if (!id || !domain || !type || !name) {
    return res.status(400).json({ error: '参数不能为空', success: false });
  }

  // 验证类型是否有效
  const validTypes = ['1', '2', '3'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: '无效的类型', success: false });
  }

  // 检查域名唯一性（排除当前记录）
  db.get('SELECT id FROM domain WHERE domain = ? AND id != ?', [domain, id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: '数据库查询失败', success: false });
    }
    if (row) {
      return res.status(400).json({ error: '该域名已存在', success: false });
    }

    db.run('UPDATE domain SET domain = ?, type = ?, name = ?, pluginId = ?, notifyContent = ? WHERE id = ?', [domain, type, name, pluginId || '1', notifyContent || '', id], function (err) {
      if (err) {
        return res.status(500).json({ error: '更新失败', success: false });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '域名记录不存在', success: false });
      }
      res.json({ success: true });
    });
  });
})

// 删除域名接口
app.post('/api/domain/delete', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id不能为空', success: false });
  }

  db.run('DELETE FROM domain WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ error: '删除失败', success: false });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: '域名记录不存在', success: false });
    }
    res.json({ success: true });
  });
});

// 获取选择器列表接口
app.get('/api/selector/list', (req, res) => {
  db.all('SELECT id, selector, created_at FROM selector ORDER BY id DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '数据库查询失败' });
    }
    res.json({ list: rows });
  });
});

// 添加选择器接口
app.post('/api/selector/add', (req, res) => {
  const { selector } = req.body;
  if (!selector) {
    return res.status(400).json({ error: '选择器不能为空', success: false });
  }

  const beijingNow = getBeijingTimeStr();
  db.run('INSERT INTO selector (selector, created_at) VALUES (?, ?)', [selector, beijingNow], function (err) {
    if (err) {
      if (err.errno === 19) { // SQLite UNIQUE constraint violation
        return res.status(400).json({ error: '该选择器已存在', success: false });
      }
      return res.status(500).json({ error: '添加失败', success: false });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// 更新选择器接口
app.post('/api/selector/update', (req, res) => {
  const { id, selector } = req.body;
  if (!id || !selector) {
    return res.status(400).json({ error: '参数不能为空', success: false });
  }

  // 检查选择器唯一性（排除当前记录）
  db.get('SELECT id FROM selector WHERE selector = ? AND id != ?', [selector, id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: '数据库查询失败', success: false });
    }
    if (row) {
      return res.status(400).json({ error: '该选择器已存在', success: false });
    }

    db.run('UPDATE selector SET selector = ? WHERE id = ?', [selector, id], function (err) {
      if (err) {
        return res.status(500).json({ error: '更新失败', success: false });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '选择器记录不存在', success: false });
      }
      res.json({ success: true });
    });
  });
})
// 删除选择器接口
app.post('/api/selector/delete', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id不能为空', success: false });
  }

  db.run('DELETE FROM selector WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ error: '删除失败', success: false });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: '选择器记录不存在', success: false });
    }
    res.json({ success: true });
  });
});

// 获取北京时间字符串
function getBeijingTimeStr() {
  return new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }).replace(/\//g, '-').replace(/年|月/g, '-').replace('日', '').replace(/\s+/, ' ');
}

function getBeijingTimeStrByDate(date) {
  return date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }).replace(/\//g, '-').replace(/年|月/g, '-').replace('日', '').replace(/\s+/, ' ');
}

function getBeijingYYYYMMDDStrByDate(date) {
  // 转为北京时间
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const beijing = new Date(utc + 8 * 3600000);
  // 补零
  const pad = n => n < 10 ? '0' + n : n;
  return `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} ${pad(beijing.getHours())}:${pad(beijing.getMinutes())}:${pad(beijing.getSeconds())}`;
}

// 获取北京时间+N天的字符串（yyyy-MM-dd HH:mm:ss）
function getBeijingTimeAfterDays(days) {
  const now = new Date();
  // 转为北京时间
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijing = new Date(utc + 8 * 3600000);
  beijing.setDate(beijing.getDate() + days);
  // 补零
  const pad = n => n < 10 ? '0' + n : n;
  return `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} ${pad(beijing.getHours())}:${pad(beijing.getMinutes())}:${pad(beijing.getSeconds())}`;
}

// 生成卡密接口
app.post('/api/generate', (req, res) => {
  const { count } = req.body;
  if (!count || count <= 0) {
    return res.status(400).json({ error: '生成数量无效' });
  }

  const codes = [];
  const now = getBeijingTimeStr();

  const insertStmt = db.prepare('INSERT INTO kami (code,machine_num, created_at) VALUES (?, ?, ?)');
  const machineNum = req.body.machineNum || 1;

  function randomCode(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let str = '';
    for (let i = 0; i < len; i++) {
      str += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return str;
  }

  db.serialize(() => {
    let inserted = 0;
    function insertNext() {
      if (inserted >= count) {
        insertStmt.finalize();
        return res.json({ codes });
      }
      const code = randomCode();
      insertStmt.run(code, machineNum, now, function (err) {
        if (!err) {
          codes.push(code);
          inserted++;
        }
        // 如果重复则不加inserted，继续插
        insertNext();
      });
    }
    insertNext();
  });
});

// 获取卡密列表接口
app.get('/api/kami', (req, res) => {
  const { code, active, disabled, remark } = req.query;
  let sql = 'SELECT id, code, is_active, machine_num, machine_band_num, created_at, activated_at, expire_at, disabled, machine, remarks FROM kami WHERE 1=1';
  const params = [];
  if (code) {
    sql += ' AND code LIKE ?';
    params.push(`%${code}%`);
  }
  if (remark) {
    sql += ' AND remarks LIKE ?';
    params.push(`%${remark}%`);
  }
  if (active === '1' || active === '0') {
    sql += ' AND is_active = ?';
    params.push(Number(active));
  }
  if (disabled === '1' || disabled === '0') {
    sql += ' AND disabled = ?';
    params.push(Number(disabled));
  }
  sql += ' ORDER BY id DESC';
  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '数据库查询失败' });
    }
    if (!rows || rows.length === 0) {
      return res.json({ list: [] });
    }
    // 获取所有卡密code
    const kamiCodes = rows.map(r => r.code);
    const placeholders = kamiCodes.map(() => '?').join(',');
    // 查询所有相关的cookie绑定
    const cookieSql = `
      SELECT kc.kami_code, kc.id as kami_cookie_id, kc.expire_at, kc.created_at,kc.active_at,kc.active_state, kc.disabled,
             ac.account_info, ac.website_info, ac.created_at as account_created_at
      FROM kami_cookies kc
      LEFT JOIN account_cookies ac ON kc.cookie_id = ac.id
      WHERE kc.kami_code IN (${placeholders})
      ORDER BY kc.id DESC
    `;
    db.all(cookieSql, kamiCodes, (err2, cookieRows) => {
      if (err2) {
        return res.status(500).json({ error: '数据库查询失败' });
      }
      // 按卡密分组
      const cookiesMap = {};
      for (const row of cookieRows) {
        if (!cookiesMap[row.kami_code]) cookiesMap[row.kami_code] = [];
        cookiesMap[row.kami_code].push({
          id: row.kami_cookie_id,
          account_info: row.account_info,
          website_info: row.website_info,
          expire_at: row.expire_at,
          created_at: row.created_at,
          active_at: row.active_at,
          active_state: row.active_state,
          disabled: row.disabled
        });
      }
      // 合并到每个卡密
      const result = rows.map(kami => ({
        ...kami,
        cookies: cookiesMap[kami.code] || []
      }));
      res.json({ list: result });
    });
  });
});

// 修改卡密机器数量接口
app.post('/api/change-machine-num', (req, res) => {
  const { id, machineNum } = req.body;
  if (!id || typeof machineNum !== 'number' || machineNum < 0) {
    return res.json({ success: false, error: '参数错误，机器数量不能小于0' });
  }

  // 首先检查卡密是否存在
  db.get('SELECT machine_band_num FROM kami WHERE id = ?', [id], (err, row) => {
    if (err) return res.json({ success: false, error: '数据库查询失败' });
    if (!row) return res.json({ success: false, error: '卡密不存在' });

    // 检查新的机器数量是否小于已绑定的机器数量
    if (machineNum < row.machine_band_num) {
      return res.json({ success: false, error: '机器数量小于已绑定数量时，请先清理' });
    }

    // 更新机器数量
    db.run('UPDATE kami SET machine_num = ? WHERE id = ?', [machineNum, id], function (err) {
      if (err) return res.json({ success: false, error: '更新失败' });
      if (this.changes === 0) return res.json({ success: false, error: '卡密不存在' });
      res.json({ success: true });
    });
  });
});

// 清理卡密绑定的所有机器接口
app.post('/api/clean-machine', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.json({ code: 400, error: '卡密ID不能为空' });
  }
  db.run('DELETE FROM machine WHERE kami_id = ?', [id], function (err) {
    if (err) return res.json({ code: 500, error: '数据库删除失败' });
    db.run('UPDATE kami SET machine_band_num = 0,machine="",activated_at=null,is_active=0 WHERE id = ?', [id], function (err2) {
      if (err2) return res.json({ code: 500, error: '数据库更新失败' });
      res.json({ success: true });
    });
  });
});



// 激活卡密接口
app.post('/api/activate', (req, res) => {
  const { code, machine } = req.body;
  if (!code || !machine) {
    return res.json({ code: 400, error: '卡密和机器码不能为空' });
  }
  // 查询卡密状态
  db.get('SELECT * FROM kami WHERE code = ?', [code], (err, row) => {
    if (err) return res.json({ code: 500, error: '数据库查询失败' });
    if (!row) return res.json({ code: 404, error: '卡密不存在' });
    if (row.disabled) {
      return res.json({ code: 403, error: '卡密已被禁用' });
    }


    // 检查卡密是否已绑定该机器码
    db.get('SELECT * FROM machine WHERE machine = ? AND kami_id = ?', [machine, row.id], (err, row1) => {
      if (err) return res.json({ code: 500, error: '数据库查询失败' });
      if (!row1) { // 未绑定机器码
        // 检查是否首次激活
        db.get('SELECT * FROM machine WHERE kami_id = ?', [row.id], (err, rows) => {
          if (err) {
            logger.error('卡密查询失败:', err.message || err);
          } else {
            if (!rows) { // 首次激活
              db.run('UPDATE kami SET is_active = 1,machine=?, activated_at = ? WHERE code = ?', [machine, getBeijingTimeStr(), code], function (err2) {
                if (err2) {
                  console.log(err2)
                }
              });
            }
          }
        });

        if (row.machine_band_num >= row.machine_num) { // 检查机器绑定数量已达上限
          return res.json({ code: 403, error: '机器绑定数量已达上限' });
        } else {// 检查机器绑定数量未达上限
          let activeSql = ''
          let activeParams = []
          activeSql = 'UPDATE kami SET machine_band_num = machine_band_num + 1,machine=? WHERE code = ?'
          activeParams = [machine, code]
          const beijingNow = getBeijingTimeStr();

          // 开始事务处理
          db.run('BEGIN TRANSACTION', (err) => {
            if (err) return res.json({ code: 500, error: '事务开始失败' });
            // 1. 更新卡密状态和机器信息
            db.run(activeSql, activeParams, function (err2) {
              if (err2) {
                console.log(err2)
                db.run('ROLLBACK');
                return res.json({ code: 500, error: '更新卡密状态失败' });
              }

              // 2. 在machine表中添加记录
              db.run('INSERT INTO machine (machine, kami_id, created_at) VALUES (?, ?, ?)',
                [machine, row.id, beijingNow], function (err3) {
                  if (err3) {
                    console.log(err3)
                    db.run('ROLLBACK');
                    return res.json({ code: 500, error: '保存机器记录失败' });
                  }

                  // 提交事务
                  db.run('COMMIT', (err4) => {
                    if (err4) {
                      db.run('ROLLBACK');
                      return res.json({ code: 500, error: '事务提交失败' });
                    }
                    res.json({ success: true, code: 0, msg: '激活成功' });
                  });
                });
            });
          });
        }
      } else {// 已绑定机器码
        //更新为本次接口调用的机器码
        let activeSql = 'UPDATE kami SET machine=? WHERE code = ?'
        let activeParams = [machine, code]
        // 1. 更新机器信息
        db.run(activeSql, activeParams, function (err2) {
          if (err2) {
            console.log(err2)
            db.run('ROLLBACK');
            return res.json({ code: 500, error: '更新卡密状态失败' });
          } else {
            res.json({ success: true, code: 0, msg: '激活成功' });
          }
        });
      }
    })
  });
});

// 校验卡密激活状态接口
app.post('/api/check', (req, res) => {
  const { code, machine } = req.body;
  if (!code || !machine) {
    return res.status(400).json({ error: '卡密和机器码不能为空' });
  }
  db.get('SELECT * FROM kami WHERE code = ?', [code], (err, row) => {
    if (err) return res.json({ error: '数据库查询失败', code: 500 });
    if (!row) return res.json({ error: '卡密不存在', code: 404 });
    if (row.disabled) {
      return res.json({ error: '卡密已被禁用', code: 403 });
    }
    if (row.is_active === 0) {
      return res.json({ error: '卡密未激活', code: 402 });
    }

    // 检查有效期
    const now = new Date();
    if (row.expire_at && new Date(row.expire_at) < now) {
      return res.json({ error: '卡密已过期', code: 410 });
    }

    if (machine !== row.machine && row.machine != "" && row.machine != null) {
      return res.json({ error: '已有其他客户端登录', code: 408 });
    }

    db.all('SELECT * FROM kami_cookies WHERE kami_code = ?', [code], (err, row) => {
      if (err) return res.json({ error: '数据库查询失败', code: 500 });

      const cookieRows = row.filter(item => item.expire_at && new Date(item.expire_at).getTime() > Date.now() || item.expire_at == "" || item.expire_at == null)
      logger.debug('查询结果:', row, cookieRows)
      if (!cookieRows || (row.length !== 0 && cookieRows.length === 0)) {
        return res.json({ error: 'cookie已过期', code: 410 });
      } else {
        res.json({ success: true, code: 0, msg: '成功' });
      }
    })
  });
});

// 设置卡密禁用/启用接口
app.post('/api/kami/status', (req, res) => {
  const { code, disabled } = req.body;
  if (!code || typeof disabled !== 'boolean') {
    return res.status(400).json({ error: '参数错误' });
  }
  db.run('UPDATE kami SET disabled = ? WHERE code = ?', [disabled ? 1 : 0, code], function (err) {
    if (err) return res.status(500).json({ error: '设置失败' });
    if (this.changes === 0) return res.status(404).json({ error: '卡密不存在' });
    res.json({ success: true });
  });
});

// 上传cookie接口
app.post('/api/cookie/upload', (req, res) => {
  const { domain, cookie, account, localstorage } = req.body;
  if (!domain || !account) {
    return res.json({ error: 'domain和账号不能为空', code: 400 });
  }
  const beijingNow = getBeijingTimeStr();

  // 首先查询domain表获取domain_id
  db.get('SELECT id FROM domain WHERE domain = ?', [domain], (err, domainRow) => {
    if (err) return res.json({ error: '数据库查询失败', code: 500 });
    if (!domainRow) {
      // 如果domain不存在，先创建
      db.run('INSERT INTO domain (domain, type, name, created_at) VALUES (?, ?, ?, ?)', [domain, '1', domain, beijingNow], function (err2) {
        if (err2) return res.json({ error: '创建domain失败', code: 500 });
        const newDomainId = this.lastID;
        insertOrUpdateAccountCookie(newDomainId);
      });
    } else {
      insertOrUpdateAccountCookie(domainRow.id);
    }
  });

  function insertOrUpdateAccountCookie(domainId) {
    // 查询是否已存在
    db.get('SELECT id FROM account_cookies WHERE domain_id = ? AND account_info = ?', [domainId, account], (err, row) => {
      if (err) return res.json({ error: '数据库查询失败', code: 500 });
      if (row) {
        // 已存在则更新
        db.run('UPDATE account_cookies SET cookie_info = ?, c = ?, website_info = ?, created_at = ? WHERE id = ?', [cookie || '', localstorage || '', domain, beijingNow, row.id], function (err2) {
          if (err2) return res.json({ error: '更新失败', code: 500 });
          res.json({ success: true, id: row.id, updated: true, code: 0 });
        });
      } else {
        // 不存在则插入
        db.run('INSERT INTO account_cookies (domain_id, website_info, cookie_info, created_at, account_info) VALUES (?, ?, ?, ?, ?)', [domainId, domain, cookie || '', beijingNow, account], function (err2) {
          if (err2) {
            logger.error('卡密激活失败:', err2.message || err2);
            return res.json({ error: '存储失败', code: 500 });
          }
          res.json({ success: true, id: this.lastID, created: true, code: 0 });
        });
      }
    });
  }
});

app.get('/api/cookie/list', (req, res) => {
  // 通过JOIN关联查询domain表获取domain和name信息
  db.all(`
    SELECT 
      ac.id, 
      d.domain, 
      d.name as domain_name,
      ac.cookie_info as cookie, 
      ac.account_info, 
      ac.created_at 
    FROM account_cookies ac
    LEFT JOIN domain d ON ac.domain_id = d.id
    ORDER BY ac.id DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    res.json({ list: rows });
  });
});

app.get('/api/cookie/listByCode', (req, res) => {
  const { code, machine } = req.query;

  // 通过多表JOIN获取关联的domain信息
  db.all(`
    SELECT 
    kc.id id,
      d.domain, 
      d.name as domain_name,
      strftime('%Y-%m-%d %H:%M:%S', kc.expire_at) as expire_at,
      kc.disabled as disabled, 
      CASE WHEN kc.disabled = 1 THEN NULL ELSE ac.cookie_info END as cookie,
      d.pluginId as pluginId,
      d.notifyContent as notifyContent  
    FROM kami_cookies kc
    LEFT JOIN account_cookies ac ON ac.id = kc.cookie_id
    LEFT JOIN domain d ON ac.domain_id = d.id
    WHERE kc.kami_code = ? 
    ORDER BY kc.id DESC
  `, [code], (err, rows) => {
    if (err) {
      console.log(err)
      return res.status(500).json({ error: '数据库查询失败' });
    } else {
      logger.debug('卡密列表查询结果:', rows.length, '条记录');
      res.json({ list: rows });
    }

  });
});

// 修改cookie接口
app.post('/api/cookie/update', (req, res) => {
  const { id, domain, cookie, account, localstorage } = req.body;
  if (!id || !domain || !account) {
    return res.status(400).json({ error: 'ID、domain和账号不能为空' });
  }
  const beijingNow = getBeijingTimeStr();

  // 首先查询domain表获取domain_id
  db.get('SELECT id FROM domain WHERE domain = ?', [domain], (err, domainRow) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    if (!domainRow) {
      // 如果domain不存在，先创建
      db.run('INSERT INTO domain (domain, type, name, created_at) VALUES (?, ?, ?, ?)', [domain, '1', domain, beijingNow], function (err2) {
        if (err2) return res.status(500).json({ error: '创建domain失败' });
        updateAccountCookie(this.lastID);
      });
    } else {
      updateAccountCookie(domainRow.id);
    }
  });

  function updateAccountCookie(domainId) {
    // 检查联合唯一
    db.get('SELECT id FROM account_cookies WHERE domain_id = ? AND account_info = ? AND id != ?', [domainId, account, id], (err, row) => {
      if (err) return res.status(500).json({ error: '数据库查询失败' });
      if (row) return res.status(400).json({ error: '同一网站下该账号已存在' });
      db.run('UPDATE account_cookies SET domain_id = ?, website_info = ?, cookie_info = ?, account_info = ?, created_at = ? WHERE id = ?', [domainId, domain, cookie || '', account, beijingNow, id], function (err2) {
        if (err2) return res.status(500).json({ error: '修改失败' });
        if (this.changes === 0) return res.status(404).json({ error: '记录不存在' });
        res.json({ success: true });
      });
    });
  }
});




// 删除单个卡密接口
app.post('/api/kami/delete', (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ error: 'code不能为空', code: 400 });

  // 使用事务确保数据一致性
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // 先删除相关的cookie绑定记录
    db.run('DELETE FROM kami_cookies WHERE kami_code = ?', [code], function (err) {
      if (err) {
        db.run('ROLLBACK');
        return res.json({ error: '删除cookie绑定失败', code: 500 });
      }

      // 再删除卡密记录
      db.run('DELETE FROM kami WHERE code = ?', [code], function (err2) {
        if (err2) {
          db.run('ROLLBACK');
          return res.json({ error: '删除失败', code: 500 });
        }
        if (this.changes === 0) {
          db.run('ROLLBACK');
          return res.json({ error: '卡密不存在', code: 404 });
        }

        db.run('COMMIT');
        res.json({ success: true, code: 0 });
      });
    });
  });
});

// 批量删除卡密接口
app.post('/api/kami/delete-batch', (req, res) => {
  const { codes } = req.body;
  if (!Array.isArray(codes) || codes.length === 0) return res.json({ error: 'codes不能为空', code: 400 });

  // 使用事务确保数据一致性
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    const placeholders = codes.map(() => '?').join(',');

    // 先删除相关的cookie绑定记录
    db.run(`DELETE FROM kami_cookies WHERE kami_code IN (${placeholders})`, codes, function (err) {
      if (err) {
        db.run('ROLLBACK');
        return res.json({ error: '删除cookie绑定失败', code: 500 });
      }

      // 再删除卡密记录
      db.run(`DELETE FROM kami WHERE code IN (${placeholders})`, codes, function (err2) {
        if (err2) {
          db.run('ROLLBACK');
          return res.json({ error: '批量删除失败', code: 500 });
        }

        db.run('COMMIT');
        res.json({ success: true, deleted: this.changes, code: 0 });
      });
    });
  });
});

// 批量更新卡密状态接口
app.post('/api/kami/reset-batch', (req, res) => {
  const { codes } = req.body;
  if (!Array.isArray(codes) || codes.length === 0) return res.json({ error: 'codes不能为空', code: 400 });

  const placeholders = codes.map(() => '?').join(',');
  const params = [...codes];

  db.run(`UPDATE kami SET is_active = 0, activated_at = NULL, machine = NULL WHERE code IN (${placeholders})`, params, function (err) {
    if (err) return res.json({ error: '批量更新失败', code: 500 });
    res.json({ success: true, updated: this.changes, code: 0 });
  });
});

// 获取公告接口
app.get('/api/notice', (req, res) => {
  db.get('SELECT content FROM notice WHERE id = 1', (err, row) => {
    if (err) return res.json({ error: '数据库查询失败', code: 500 });
    res.json({ content: row ? row.content : '', code: 0 });
  });
});

// 设置公告接口
app.post('/api/notice', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.json({ error: '参数错误', code: 400 });
  db.run('INSERT INTO notice (id, content) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET content=excluded.content', [content], function (err) {
    if (err) return res.json({ error: '保存失败', code: 500 });
    res.json({ success: true, code: 0 });
  });
});

// 更新卡密到期时间接口
app.post('/api/kami/expire', (req, res) => {
  const { code, expire_at } = req.body;
  if (!code || !expire_at) {
    return res.status(400).json({ error: '参数不能为空' });
  }
  db.run('UPDATE kami SET expire_at = ? WHERE code = ?', [expire_at, code], function (err) {
    if (err) return res.status(500).json({ error: '更新到期时间失败' });
    if (this.changes === 0) return res.status(404).json({ error: '卡密不存在' });
    res.json({ success: true });
  });
});

// 更新卡密备注接口
app.post('/api/kami/remarks', (req, res) => {
  const { code, remarks } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'code不能为空' });
  }
  if (typeof remarks !== 'string') {
    return res.status(400).json({ error: '参数错误' });
  }
  db.run('UPDATE kami SET remarks = ? WHERE code = ?', [remarks, code], function (err) {
    if (err) return res.status(500).json({ error: '更新备注失败' });
    if (this.changes === 0) return res.status(404).json({ error: '卡密不存在' });
    res.json({ success: true });
  });
});

// 更新卡密信息接口
app.post('/api/kami/update', (req, res) => {
  const { code, period, remarks, expire_at } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'code不能为空' });
  }

  // 构建更新字段
  const updateFields = [];
  const params = [];

  if (period !== undefined) {
    updateFields.push('period = ?');
    params.push(period);
  }

  if (remarks !== undefined) {
    updateFields.push('remarks = ?');
    params.push(remarks);
  }

  if (expire_at !== undefined && expire_at !== null) {
    updateFields.push('expire_at = ?');
    params.push(expire_at);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: '没有要更新的字段' });
  }

  params.push(code);
  const sql = `UPDATE kami SET ${updateFields.join(', ')} WHERE code = ?`;

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: '更新失败' });
    if (this.changes === 0) return res.status(404).json({ error: '卡密不存在' });
    res.json({ success: true });
  });
});

// 修改密码接口
app.post('/api/change-pwd', express.json(), (req, res) => {
  if (!req.session || !req.session.auth) {
    return res.status(401).json({ success: false, msg: '未登录' });
  }
  const { oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd) {
    return res.json({ success: false, msg: '参数不能为空' });
  }
  db.get('SELECT pwd FROM admin_pwd WHERE id=1', (err, row) => {
    if (row && oldPwd === row.pwd) {
      db.run('UPDATE admin_pwd SET pwd=? WHERE id=1', [newPwd], (err2) => {
        if (err2) return res.json({ success: false, msg: '修改失败' });
        res.json({ success: true });
      });
    } else {
      res.json({ success: false, msg: '原密码错误' });
    }
  });
});

// 退出登录接口
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// 删除卡密关联cookie接口
app.post('/api/kami-cookie/delete', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID不能为空' });

  db.run('DELETE FROM kami_cookies WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: '删除失败' });
    if (this.changes === 0) return res.status(404).json({ error: '关联记录不存在' });
    res.json({ success: true });
  });
});


// 根据卡密获取关联的cookie接口
app.get('/api/kami-cookie/by-kami/:kami_code', (req, res) => {
  const { kami_code } = req.params;
  if (!kami_code) return res.status(400).json({ error: '卡密代码不能为空' });

  const sql = `
    SELECT kc.id, kc.kami_code, kc.cookie_id, kc.expire_at, kc.disabled, kc.created_at,
           ac.account_info, ac.website_info
    FROM kami_cookies kc
    LEFT JOIN account_cookies ac ON kc.cookie_id = ac.id
    WHERE kc.kami_code = ?
    ORDER BY kc.id DESC
  `;

  db.all(sql, [kami_code], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    res.json({ list: rows });
  });
});

// 添加账号与cookie关系接口
app.post('/api/account-cookie/add', (req, res) => {
  const { account_info, cookie_info, website_info, domain_id } = req.body;
  if (!account_info || !website_info) {
    return res.status(400).json({ error: '账号信息和网站信息不能为空' });
  }

  const beijingNow = getBeijingTimeStr();
  db.run('INSERT INTO account_cookies (account_info, cookie_info, domain_id, created_at) VALUES (?, ?, ?, ?)',
    [account_info, cookie_info || '', domain_id, beijingNow], function (err) {
      if (err) return res.status(500).json({ error: '添加失败' });
      res.json({ success: true, id: this.lastID });
    });
});

// 获取账号与cookie关系列表接口
app.get('/api/account-cookie/list', (req, res) => {
  const { domain_id } = req.query;
  let sql = 'SELECT id, account_info, cookie_info, domain_id, created_at FROM account_cookies WHERE 1=1';
  const params = [];

  if (domain_id) {
    sql += ' AND domain_id = ?';
    params.push(domain_id);
  }

  sql += ' ORDER BY id DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    res.json({ list: rows });
  });

});

// 修改账号与cookie关系接口
app.post('/api/account-cookie/update', (req, res) => {
  const { id, account_info, cookie_info, website_info, domain_id } = req.body;
  if (!id || !account_info || !website_info) {
    return res.status(400).json({ error: 'ID、账号信息和网站信息不能为空' });
  }

  const beijingNow = getBeijingTimeStr();
  db.run('UPDATE account_cookies SET account_info = ?, cookie_info = ?, domain_id = ?, website_info = ?, created_at = ? WHERE id = ?',
    [account_info, cookie_info || '', domain_id, website_info, beijingNow, id], function (err) {
      if (err) return res.status(500).json({ error: '更新失败' });
      if (this.changes === 0) return res.status(404).json({ error: '记录不存在' });
      res.json({ success: true });
    });
});

// 删除账号与cookie关系接口
app.post('/api/account-cookie/delete', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID不能为空' });

  db.run('DELETE FROM account_cookies WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: '删除失败' });
    if (this.changes === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ success: true });
  });
});

// 根据网站信息获取账号列表接口
app.get('/api/account-cookie/by-website', (req, res) => {
  const { website_info } = req.query;
  if (!website_info) {
    return res.status(400).json({ error: '网站信息不能为空' });
  }
  const sql = 'SELECT id, account_info FROM account_cookies WHERE website_info = ? ORDER BY id DESC';
  db.all(sql, [website_info], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    res.json({ list: rows });
  });
});

// 卡密关联账号cookie接口（使用account_cookies表的ID）
app.post('/api/kami-account-cookie/add', (req, res) => {
  let { kami_code, account_cookie_id, duration_type, duration } = req.body;
  let durationType = duration_type || 'h';
  if (!kami_code || !account_cookie_id) {
    return res.status(400).json({ error: '卡密代码和账号Cookie ID不能为空' });
  }


  // 检查卡密是否存在
  db.get('SELECT id FROM kami WHERE code = ?', [kami_code], (err, kamiRow) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    if (!kamiRow) return res.status(404).json({ error: '卡密不存在' });

    // 检查账号cookie是否存在
    db.get('SELECT id, website_info FROM account_cookies WHERE id = ?', [account_cookie_id], (err2, accountRow) => {
      if (err2) return res.status(500).json({ error: '数据库查询失败' });
      if (!accountRow) return res.status(404).json({ error: '账号Cookie不存在' });

      // 新增：同一激活码同一域名只能绑定一个cookie
      db.get('SELECT kc.id FROM kami_cookies kc LEFT JOIN account_cookies ac ON kc.cookie_id = ac.id WHERE kc.kami_code = ? AND ac.website_info = ?', [kami_code, accountRow.website_info], (errX, existRow) => {
        /*if (errX) return res.status(500).json({ error: '数据库查询失败' });
        if (existRow) return res.status(400).json({ error: '同一个激活码对同一域名只能绑定一个cookie' });*/

        // 检查是否已存在关联
        db.get('SELECT id FROM kami_cookies WHERE kami_code = ? AND cookie_id = ?', [kami_code, account_cookie_id], (err3, existingRow) => {
          if (err3) return res.status(500).json({ error: '数据库查询失败' });
          if (existingRow) return res.status(400).json({ error: '该卡密已关联此账号Cookie' });

          const beijingNow = getBeijingTimeStr();
          db.run('INSERT INTO kami_cookies (kami_code, cookie_id, duration_type, duration, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)',
            [kami_code, account_cookie_id, durationType, duration, beijingNow], function (err4) {
              console.log('err4', err4);
              // logger.error('卡密状态更新失败:', err4.message || err4);
              if (err4) return res.status(500).json({ error: '添加关联失败' });
              res.json({ success: true, id: this.lastID });
            });
        });
      });
    });
  });
});

// 获取卡密关联的账号cookie列表
app.get('/api/kami-account-cookie/by-kami/:kami_code', (req, res) => {
  const { kami_code } = req.params;
  if (!kami_code) return res.status(400).json({ error: '卡密代码不能为空' });

  const sql = `
    SELECT kc.id, kc.kami_code, kc.cookie_id, kc.expire_at, kc.disabled, kc.created_at,
           ac.account_info,  d.domain website_info,kc.duration_type,kc.duration,
           kc.active_at, kc.active_state,ac.domain_id  
    FROM kami_cookies kc
    LEFT JOIN account_cookies ac ON kc.cookie_id = ac.id
    LEFT JOIN domain d ON ac.domain_id = d.id
    WHERE kc.kami_code = ?
    ORDER BY kc.id DESC
  `;

  db.all(sql, [kami_code], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    res.json({ list: rows });
  });
});

// 删除卡密关联的账号cookie
app.post('/api/kami-account-cookie/delete', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID不能为空' });

  db.run('DELETE FROM kami_cookies WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: '删除失败' });
    if (this.changes === 0) return res.status(404).json({ error: '关联记录不存在' });
    res.json({ success: true });
  });
});

// 更新卡密关联的账号cookie
app.post('/api/kami-account-cookie/update', (req, res) => {
  const { id, account_info, website_info, expire_at } = req.body;
  if (!id) return res.status(400).json({ error: 'ID不能为空' });

  // 首先获取当前的关联记录
  db.get('SELECT cookie_id FROM kami_cookies WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    if (!row) return res.status(404).json({ error: '关联记录不存在' });

    // 更新account_cookies表中的信息
    db.run('UPDATE account_cookies SET account_info = ?, website_info = ? WHERE id = ?',
      [account_info, website_info, row.cookie_id], function (err2) {
        if (err2) return res.status(500).json({ error: '更新账号信息失败' });

        // 更新kami_cookies表中的过期时间
        db.run('UPDATE kami_cookies SET expire_at = ? WHERE id = ?',
          [expire_at, id], function (err3) {
            if (err3) return res.status(500).json({ error: '更新过期时间失败' });
            res.json({ success: true });
          });
      });
  });
});

// 切换卡密关联的账号cookie状态
app.post('/api/kami-account-cookie/status', (req, res) => {
  const { id, disabled } = req.body;
  if (!id) return res.status(400).json({ error: 'ID不能为空' });
  if (disabled === undefined) return res.status(400).json({ error: '状态参数不能为空' });

  db.run('UPDATE kami_cookies SET disabled = ? WHERE id = ?', [disabled, id], function (err) {
    if (err) return res.status(500).json({ error: '更新状态失败' });
    if (this.changes === 0) return res.status(404).json({ error: '关联记录不存在' });
    res.json({ success: true });
  });
});

// 新增：修改卡密绑定的账号
app.post('/api/kami-account-cookie/change-account', (req, res) => {
  const { id, new_account_cookie_id } = req.body;
  if (!id || !new_account_cookie_id) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 1. 验证新的 account_cookie_id 是否存在
  db.get('SELECT id FROM account_cookies WHERE id = ?', [new_account_cookie_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: '数据库查询出错' });
    }
    if (!row) {
      return res.status(404).json({ error: '要绑定的新Cookie不存在' });
    }

    // 2. 更新 kami_cookies 表
    const sql = `UPDATE kami_cookies SET cookie_id = ? WHERE id = ?`;
    db.run(sql, [new_account_cookie_id, id], function (err) {
      if (err) {
        return res.status(500).json({ error: '更新失败: ' + err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '未找到要更新的绑定记录' });
      }
      res.json({ success: true });
    });
  });
});


// 点击卡密-cookie激活
app.post('/api/kami-cookie/active', (req, res) => {
  const { id } = req.body;
  // 开始事务
  db.run('BEGIN TRANSACTION', (err) => {
    if (err) {
      return res.status(500).json({ error: '事务开始失败', message: err.message });
    }

    // 首先检查并获取记录的duration_type和duration
    db.get('SELECT id, duration_type,kami_code, duration FROM kami_cookies WHERE id = ?',
      [id], (err, row) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: '查询卡密失败', message: err.message });
        }
        logger.debug('卡密详情:', row.id, row.code);
        if (!row) {
          db.run('ROLLBACK');
          return res.status(404).json({ error: '未找到该卡密或卡密已激活' });
        }
        if (row.active_state === 1) {//已激活
          res.json({
            success: true,
            message: '卡密激活成功',
            active_at: active_at,
            expire_at: expire_at
          });

        } else {// 未激活状态
          const { id, duration_type, duration } = row;
          const active_at = getBeijingYYYYMMDDStrByDate(new Date()); //new Date().toISOString();

          // 计算过期时间
          let expire_at = null;
          logger.debug('设置时长:', duration, duration_type);
          if (duration > 0 && duration_type) {
            const expireDate = new Date();
            switch (duration_type) {
              case 'm': // 分钟
                expireDate.setMinutes(expireDate.getMinutes() + duration);
                break;
              case 'h': // 小时
                expireDate.setHours(expireDate.getHours() + duration);
                break;
              case 'd': // 天
                expireDate.setDate(expireDate.getDate() + duration);
                break;
              case 'w': // 周
                expireDate.setDate(expireDate.getDate() + duration * 7);
                break;
              case 'M': // 月
                expireDate.setMonth(expireDate.getMonth() + duration);
                break;
              case 'y': // 年
                expireDate.setFullYear(expireDate.getFullYear() + duration);
                break;
              default:
                // 默认按小时计算
                expireDate.setHours(expireDate.getHours() + duration);
            }
            expire_at = getBeijingYYYYMMDDStrByDate(expireDate);
          }
          logger.debug('激活时间:', active_at, '到期时间:', expire_at);

          // 更新记录
          db.run(
            'UPDATE kami_cookies SET active_state = 1, active_at = ?, expire_at = ? WHERE id = ?',
            [active_at, expire_at, id],
            function (err) {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: '更新卡密状态失败', message: err.message });
              }

              if (this.changes === 0) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: '更新失败，未找到记录' });
              }

              // 提交事务
              db.run('COMMIT', (err) => {
                if (err) {
                  return res.status(500).json({ error: '事务提交失败', message: err.message });
                }

                res.json({
                  success: true,
                  message: '卡密激活成功',
                  active_at: active_at,
                  expire_at: expire_at
                });
              });
            }
          );
        }

      });
  });
});

// 点击卡密-cookie激活
app.post('/getuX3dA0rL6iP0pE7v', async (req, res) => {
  let clientIP = req.ip;
  logger.debug('客户端IP:', clientIP);
  logger.debug('同步数据请求:', { rows_count: req.body.rows?.length });
  let rows = req.body.rows
  for (let row of rows) {
    let { domain, account_info, cookie_info, name, pluginId } = row
    logger.debug('处理同步数据:', { domain, name, pluginId });
    let domainName = domain + "_" + name
    let id = null
    let sql = `SELECT id FROM domain WHERE name = ? and domain = ?`
    let domainRow = await dbGetP(sql, [domainName, domain], db)
    if (domainRow) {
      id = domainRow.id
      // 更新
      sql = `UPDATE domain SET pluginId = ? WHERE id = ?`
      await dbUpdateP(sql, [pluginId, id], db)
    } else {
      // 插入
      sql = `INSERT INTO domain (domain, name, pluginId) VALUES (?, ?, ?)`
      id = await dbInsertP(sql, [domain, domainName, pluginId], db)
    }
    let cookieSql = `SELECT * FROM account_cookies WHERE domain_id = ? and account_info = ?`
    let accountInfo = await dbGetP(cookieSql, [id, account_info], db)
    if (accountInfo) {
      let updateSql = `update account_cookies set cookie_info = ? where id = ? `
      await dbUpdateP(updateSql, [cookie_info, accountInfo.id], db)
    } else {
      // 插入
      let sql = `INSERT INTO account_cookies (domain_id, account_info, cookie_info) VALUES (?, ?, ?)`
      await dbInsertP(sql, [id, account_info, cookie_info], db)
    }
  }
});

app.get('/test', async (req, res) => {
  let clientIP = req.ip;
  logger.debug('客户端IP:', clientIP);
  res.json({
    success: true,
    message: '测试成功'
  });
});

// 添加静态资源服务
app.use(express.static(path.join(__dirname, 'public')));

// 数据库备份函数
function backupDatabase() {
  try {
    const sourceDb = path.join(__dirname, 'kami.db');
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const backupFile = path.join(backupDir, `kami_${dateStr}.db`);

    // 检查源文件是否存在
    if (!fs.existsSync(sourceDb)) {
      logger.warn(`源数据库文件不存在: ${sourceDb}`);
      return;
    }

    // 复制文件（覆盖已存在的同名文件）
    fs.copyFileSync(sourceDb, backupFile);
    logger.info(`数据库备份成功: ${backupFile}`);
  } catch (error) {
    logger.error('数据库备份失败:', error.message);
  }
}

// 设置每两小时执行一次备份
schedule.scheduleJob('0 */2 * * *', backupDatabase);
logger.info('已设置数据库定时备份任务: 每两小时执行一次');

// 启动时立即执行一次备份
backupDatabase();

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`服务器运行在 http://0.0.0.0:${PORT}`);
});

// 关闭数据库连接的处理
process.on('SIGINT', () => {
  logger.info('服务器正在关闭...');
  db.close((err) => {
    if (err) {
      logger.error('关闭数据库连接失败:', err.message);
    } else {
      logger.info('数据库连接已关闭');
    }
    process.exit();
  });
});


function dbGetP(sql, params, db) {
  logger.debug('数据库查询:', sql, '参数:', params)
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        logger.error('数据库查询失败:', err.message);
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


