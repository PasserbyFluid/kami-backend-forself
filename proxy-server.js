const net = require('net');
const crypto = require('crypto');

// 兼容低版本 Node.js 的随机 UUID 生成函数
function generateUUID() {
  // 兼容低版本的替代方案
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // 设置版本号 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // 设置变体位
  
  const hex = bytes.toString('hex');
  return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20)}`;
}

// SOCKS5代理服务器
class Socks5ProxyServer {
  constructor(options = {}) {
    this.port = options.port || 1080;
    this.host = options.host || '0.0.0.0';
    this.auth = options.auth || false;
    this.username = options.username || '';
    this.password = options.password || '';
    this.server = null;
    this.connections = new Set();
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      bytesTransferred: 0
    };
  }

  // 启动服务器
  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.listen(this.port, this.host, () => {
        console.log(`SOCKS5代理服务器启动在 ${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('服务器错误:', error);
        reject(error);
      });
    });
  }

  // 停止服务器
  stop() {
    return new Promise((resolve) => {
      // 关闭所有活动连接
      for (const connection of this.connections) {
        connection.destroy();
      }
      this.connections.clear();

      if (this.server) {
        this.server.close(() => {
          console.log('SOCKS5代理服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // 处理连接
  handleConnection(socket) {
    const connectionId = generateUUID();
    this.connections.add(socket);
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    console.log(`[${connectionId}] 新连接来自: ${socket.remoteAddress}:${socket.remotePort}`);

    let state = 'handshake';
    let targetSocket = null;

    // 握手阶段
    const handleHandshake = (data) => {
      try {
        // SOCKS5协议版本检查
        if (data.length < 3 || data[0] !== 0x05) {
          socket.end();
          return;
        }

        const numMethods = data[1];
        const methods = data.slice(2, 2 + numMethods);

        // 选择认证方法
        let selectedMethod = 0x00; // 无认证
        if (this.auth) {
          // 需要用户名密码认证
          if (methods.includes(0x02)) {
            selectedMethod = 0x02;
          } else {
            // 客户端不支持用户名密码认证
            socket.write(Buffer.from([0x05, 0xFF]));
            socket.end();
            return;
          }
        } else {
          // 无认证
          if (methods.includes(0x00)) {
            selectedMethod = 0x00;
          } else {
            // 客户端不支持无认证
            socket.write(Buffer.from([0x05, 0xFF]));
            socket.end();
            return;
          }
        }

        socket.write(Buffer.from([0x05, selectedMethod]));
        
        if (selectedMethod === 0x02) {
          state = 'auth';
        } else {
          state = 'request';
        }
      } catch (error) {
        console.error(`[${connectionId}] 握手错误:`, error);
        socket.end();
      }
    };

    // 认证阶段
    const handleAuth = (data) => {
      try {
        if (data.length < 3 || data[0] !== 0x01) {
          socket.write(Buffer.from([0x01, 0x01])); // 认证失败
          socket.end();
          return;
        }

        const userLen = data[1];
        const username = data.slice(2, 2 + userLen).toString();
        const passLen = data[2 + userLen];
        const password = data.slice(3 + userLen, 3 + userLen + passLen).toString();

        if (username === this.username && password === this.password) {
          socket.write(Buffer.from([0x01, 0x00])); // 认证成功
          state = 'request';
        } else {
          socket.write(Buffer.from([0x01, 0x01])); // 认证失败
          socket.end();
        }
      } catch (error) {
        console.error(`[${connectionId}] 认证错误:`, error);
        socket.end();
      }
    };

    // 请求阶段
    const handleRequest = (data) => {
      try {
        if (data.length < 10 || data[0] !== 0x05) {
          socket.end();
          return;
        }

        const cmd = data[1];
        const atyp = data[3];

        if (cmd !== 0x01) { // 只支持CONNECT命令
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // 命令不支持
          socket.end();
          return;
        }

        let targetHost, targetPort;
        let responseBuffer;

        // 解析目标地址
        if (atyp === 0x01) { // IPv4
          if (data.length < 10) {
            socket.end();
            return;
          }
          targetHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
          targetPort = data.readUInt16BE(8);
          responseBuffer = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        } else if (atyp === 0x03) { // 域名
          const domainLen = data[4];
          if (data.length < 7 + domainLen) {
            socket.end();
            return;
          }
          targetHost = data.slice(5, 5 + domainLen).toString();
          targetPort = data.readUInt16BE(5 + domainLen);
          responseBuffer = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        } else if (atyp === 0x04) { // IPv6
          if (data.length < 22) {
            socket.end();
            return;
          }
          const ipv6Bytes = data.slice(4, 20);
          targetHost = Array.from(ipv6Bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
          targetPort = data.readUInt16BE(20);
          responseBuffer = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        } else {
          socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // 地址类型不支持
          socket.end();
          return;
        }

        console.log(`[${connectionId}] 连接目标: ${targetHost}:${targetPort}`);

        // 连接到目标服务器
        targetSocket = net.createConnection(targetPort, targetHost, () => {
          socket.write(responseBuffer);
          state = 'relay';
          console.log(`[${connectionId}] 已连接到目标服务器`);
        });

        targetSocket.on('data', (data) => {
          this.stats.bytesTransferred += data.length;
          socket.write(data);
        });

        targetSocket.on('end', () => {
          console.log(`[${connectionId}] 目标服务器断开连接`);
          socket.end();
        });

        targetSocket.on('error', (error) => {
          console.error(`[${connectionId}] 目标服务器错误:`, error);
          socket.write(Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // 主机不可达
          socket.end();
        });

      } catch (error) {
        console.error(`[${connectionId}] 请求错误:`, error);
        socket.end();
      }
    };

    // 数据转发阶段
    const handleRelay = (data) => {
      if (targetSocket && targetSocket.writable) {
        this.stats.bytesTransferred += data.length;
        targetSocket.write(data);
      }
    };

    // 主数据处理函数
    const handleData = (data) => {
      try {
        switch (state) {
          case 'handshake':
            handleHandshake(data);
            break;
          case 'auth':
            handleAuth(data);
            break;
          case 'request':
            handleRequest(data);
            break;
          case 'relay':
            handleRelay(data);
            break;
        }
      } catch (error) {
        console.error(`[${connectionId}] 数据处理错误:`, error);
        socket.end();
      }
    };

    socket.on('data', handleData);

    socket.on('end', () => {
      console.log(`[${connectionId}] 客户端断开连接`);
      if (targetSocket) {
        targetSocket.destroy();
      }
      this.connections.delete(socket);
      this.stats.activeConnections--;
    });

    socket.on('error', (error) => {
      console.error(`[${connectionId}] 客户端错误:`, error);
      if (targetSocket) {
        targetSocket.destroy();
      }
      this.connections.delete(socket);
      this.stats.activeConnections--;
    });
  }

  // 获取统计信息
  getStats() {
    return {
      ...this.stats,
      uptime: process.uptime()
    };
  }
}

// 创建服务器实例
const proxyServer = new Socks5ProxyServer({
  port: 1080,
  host: '0.0.0.0',
  auth: false, // 设置为true启用认证
  username: '', // 认证用户名
  password: '' // 认证密码
});

// 处理进程信号
process.on('SIGINT', async () => {
  console.log('正在关闭代理服务器...');
  await proxyServer.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭代理服务器...');
  await proxyServer.stop();
  process.exit(0);
});

// 启动服务器
async function startServer() {
  try {
    await proxyServer.start();
    
    // 定期打印统计信息
    setInterval(() => {
      const stats = proxyServer.getStats();
      console.log(`[统计] 总连接: ${stats.totalConnections}, 活跃连接: ${stats.activeConnections}, 传输字节: ${stats.bytesTransferred}, 运行时间: ${Math.floor(stats.uptime)}秒`);
    }, 60000); // 每分钟打印一次
    
  } catch (error) {
    console.error('启动代理服务器失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则启动服务器
if (require.main === module) {
  startServer();
}

module.exports = { Socks5ProxyServer };