const net = require('net');

/**
 * SOCKS5代理客户端
 * 用于测试SOCKS5代理服务器功能
 */
class Socks5Client {
  constructor(options = {}) {
    this.proxyHost = options.proxyHost || '43.248.188.75';
    this.proxyPort = options.proxyPort || 23753;
    this.auth = options.auth || false;
    this.username = options.username || '';
    this.password = options.password || '';
    this.timeout = options.timeout || 30000;
  }

  /**
   * 连接到目标服务器
   * @param {string} targetHost 目标主机
   * @param {number} targetPort 目标端口
   * @returns {Promise<net.Socket>} 连接的socket
   */
  async connect(targetHost, targetPort) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.proxyHost,
        port: this.proxyPort
      });

      socket.setTimeout(this.timeout);
      let stage = 'handshake';
      let buffer = Buffer.alloc(0);

      // 错误处理
      socket.on('error', (err) => {
        reject(new Error(`连接错误: ${err.message}`));
      });

      socket.on('timeout', () => {
        reject(new Error('连接超时'));
      });

      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        try {
          if (stage === 'handshake') {
            // 处理握手响应
            if (buffer.length >= 2 && buffer[0] === 0x05) {
              const method = buffer[1];
              buffer = buffer.slice(2);

              if (method === 0xFF) {
                throw new Error('代理服务器不支持请求的认证方法');
              }

              if (method === 0x02) {
                // 需要认证
                stage = 'auth';
                this.sendAuth(socket);
              } else {
                // 无需认证，直接发送连接请求
                stage = 'request';
                this.sendRequest(socket, targetHost, targetPort);
              }
            }
          } else if (stage === 'auth') {
            // 处理认证响应
            if (buffer.length >= 2 && buffer[0] === 0x01) {
              const status = buffer[1];
              buffer = buffer.slice(2);

              if (status !== 0x00) {
                throw new Error('认证失败');
              }

              // 认证成功，发送连接请求
              stage = 'request';
              this.sendRequest(socket, targetHost, targetPort);
            }
          } else if (stage === 'request') {
            // 处理连接响应
            if (buffer.length >= 10 && buffer[0] === 0x05) {
              const reply = buffer[1];
              
              if (reply !== 0x00) {
                const errorMessages = {
                  0x01: '代理服务器失败',
                  0x02: '连接不允许',
                  0x03: '网络不可达',
                  0x04: '主机不可达',
                  0x05: '连接被拒绝',
                  0x06: 'TTL过期',
                  0x07: '命令不支持',
                  0x08: '地址类型不支持'
                };
                throw new Error(`连接失败: ${errorMessages[reply] || '未知错误'}`);
              }

              // 连接成功，清除事件监听器
              socket.removeAllListeners('data');
              socket.removeAllListeners('timeout');
              resolve(socket);
            }
          }
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      });

      // 发送握手请求
      this.sendHandshake(socket);
    });
  }

  /**
   * 发送握手请求
   * @param {net.Socket} socket 连接的socket
   */
  sendHandshake(socket) {
    let methods = [0x00]; // 无认证
    if (this.auth) {
      methods = [0x00, 0x02]; // 无认证和用户名密码认证
    }

    const handshakeBuffer = Buffer.alloc(2 + methods.length);
    handshakeBuffer[0] = 0x05; // SOCKS版本
    handshakeBuffer[1] = methods.length;
    methods.forEach((method, index) => {
      handshakeBuffer[2 + index] = method;
    });

    socket.write(handshakeBuffer);
  }

  /**
   * 发送认证请求
   * @param {net.Socket} socket 连接的socket
   */
  sendAuth(socket) {
    const usernameBuffer = Buffer.from(this.username);
    const passwordBuffer = Buffer.from(this.password);
    const authBuffer = Buffer.alloc(3 + usernameBuffer.length + passwordBuffer.length);

    authBuffer[0] = 0x01; // 认证版本
    authBuffer[1] = usernameBuffer.length;
    usernameBuffer.copy(authBuffer, 2);
    authBuffer[2 + usernameBuffer.length] = passwordBuffer.length;
    passwordBuffer.copy(authBuffer, 3 + usernameBuffer.length);

    socket.write(authBuffer);
  }

  /**
   * 发送连接请求
   * @param {net.Socket} socket 连接的socket
   * @param {string} targetHost 目标主机
   * @param {number} targetPort 目标端口
   */
  sendRequest(socket, targetHost, targetPort) {
    let requestBuffer;
    let atyp;
    let addressBuffer;

    // 检查是否为IPv4地址
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (ipv4Regex.test(targetHost)) {
      atyp = 0x01; // IPv4
      addressBuffer = Buffer.from(targetHost.split('.').map(Number));
    } else {
      // 假设是域名
      atyp = 0x03; // 域名
      addressBuffer = Buffer.from(targetHost);
    }

    if (atyp === 0x01) {
      requestBuffer = Buffer.alloc(10);
      requestBuffer[0] = 0x05; // SOCKS版本
      requestBuffer[1] = 0x01; // CONNECT命令
      requestBuffer[2] = 0x00; // 保留
      requestBuffer[3] = atyp;
      addressBuffer.copy(requestBuffer, 4);
      requestBuffer.writeUInt16BE(targetPort, 8);
    } else {
      requestBuffer = Buffer.alloc(7 + addressBuffer.length);
      requestBuffer[0] = 0x05; // SOCKS版本
      requestBuffer[1] = 0x01; // CONNECT命令
      requestBuffer[2] = 0x00; // 保留
      requestBuffer[3] = atyp;
      requestBuffer[4] = addressBuffer.length;
      addressBuffer.copy(requestBuffer, 5);
      requestBuffer.writeUInt16BE(targetPort, 5 + addressBuffer.length);
    }

    socket.write(requestBuffer);
  }

  /**
   * 测试代理连接
   * @param {string} targetHost 目标主机
   * @param {number} targetPort 目标端口
   * @returns {Promise<object>} 测试结果
   */
  async testConnection(targetHost = 'http://43.248.188.75', targetPort = 29026) {
    console.log(`开始测试代理连接: ${this.proxyHost}:${this.proxyPort} -> ${targetHost}:${targetPort}`);
    
    try {
      const startTime = Date.now();
      const socket = await this.connect(targetHost, targetPort);
      const connectTime = Date.now() - startTime;
      
      // 发送HTTP请求测试
      const httpRequest = `GET / HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`;
      
      return new Promise((resolve) => {
        let response = '';
        
        socket.on('data', (data) => {
          response += data.toString();
        });
        
        socket.on('end', () => {
          socket.destroy();
          
          // 简单验证响应
          const statusCodeMatch = response.match(/^HTTP\/\d\.\d (\d{3})/);
          const statusCode = statusCodeMatch ? parseInt(statusCodeMatch[1]) : 0;
          const success = statusCode >= 200 && statusCode < 400;
          
          resolve({
            success,
            connectTime,
            statusCode,
            responseSample: response.substring(0, 200) + (response.length > 200 ? '...' : ''),
            fullResponseLength: response.length
          });
        });
        
        socket.write(httpRequest);
      });
    } catch (error) {
      return {
        success: false,
        error: error.message,
        connectTime: 0
      };
    }
  }

  /**
   * 运行完整的代理测试套件
   */
  async runTestSuite() {
    console.log('============================================');
    console.log('SOCKS5代理测试套件');
    console.log(`代理服务器: ${this.proxyHost}:${this.proxyPort}`);
    console.log(`认证: ${this.auth ? '启用' : '禁用'} ${this.auth ? `(${this.username})` : ''}`);
    console.log('============================================');
    
    // 测试1: 连接百度
    console.log('\n[测试1] 连接百度...');
      const result1 = await this.testConnection('43.248.188.75', 29026);
    //   const result1 = await this.testConnection('http://43.248.188.75', 32229);
    this.printTestResult(result1);
    
    console.log('\n============================================');
    console.log('测试完成!');
    console.log('============================================');
  }

  /**
   * 打印测试结果
   * @param {object} result 测试结果
   */
  printTestResult(result) {
    if (result.success) {
      console.log(`✅ 成功`);
      console.log(`   连接时间: ${result.connectTime}ms`);
      console.log(`   HTTP状态码: ${result.statusCode}`);
      console.log(`   响应长度: ${result.fullResponseLength} 字节`);
      console.log(`   响应示例: ${result.responseSample}`);
    } else {
      console.log(`❌ 失败`);
      console.log(`   错误信息: ${result.error}`);
    }
  }
}

/**
 * 创建一个简单的HTTP客户端，通过SOCKS5代理发送请求
 * @param {object} options 选项
 * @returns {Promise<string>} HTTP响应
 */
async function httpRequestViaProxy(options) {
  const { 
    url, 
    proxyHost = '43.248.188.75', 
    proxyPort = 23753,
    auth = false,
    username = '',
    password = ''
  } = options;
  
  // 解析URL
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;
  const port = parsedUrl.port || 80;
  const path = parsedUrl.pathname + parsedUrl.search;
  
  // 创建SOCKS5客户端
  const client = new Socks5Client({
    proxyHost,
    proxyPort,
    auth,
    username,
    password
  });
  
  try {
    const socket = await client.connect(hostname, port);
    
    return new Promise((resolve, reject) => {
      let response = '';
      
      socket.on('data', (data) => {
        response += data.toString();
      });
      
      socket.on('end', () => {
        socket.destroy();
        resolve(response);
      });
      
      socket.on('error', (error) => {
        socket.destroy();
        reject(error);
      });
      
      // 发送HTTP请求
      const request = `GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`;
      socket.write(request);
    });
  } catch (error) {
    throw error;
  }
}

// 示例使用
async function main() {
  // 创建代理客户端
  const client = new Socks5Client({
    proxyHost: '43.248.188.75',
    proxyPort: 23753,
    auth: false, // 如果代理服务器启用了认证，设置为true
    username: '', // 认证用户名
    password: ''  // 认证密码
  });
  
  // 运行测试套件
  await client.runTestSuite();
  
  // 也可以单独测试特定URL
  try {
    console.log('\n[额外测试] 发送自定义HTTP请求...');
    const response = await httpRequestViaProxy({
      url: 'http://httpbin.org/ip',
      proxyHost: '43.248.188.75',
      proxyPort: 23753
    });
    console.log('响应:', response);
  } catch (error) {
    console.error('请求失败:', error.message);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { Socks5Client, httpRequestViaProxy };