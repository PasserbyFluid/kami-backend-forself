const net = require('net');
const dns = require('dns');

// 配置参数（建议改为环境变量）
const CONFIG = {
    PORT: 6532, // SOCKS5 代理端口
    ALLOWED_IPS: new Set(['127.0.0.1', '192.168.1.100']), // 允许访问的IP
    PROTOCOL_VERSION: 0x05
};

// SOCKS5 响应码生成器
const RESPONSE = {
    SUCCESS: Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
    AUTH_FAIL: Buffer.from([0x05, 0xFF]),
    CONNECT_REFUSED: Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
    HOST_UNREACHABLE: Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
};

const server = net.createServer((clientSocket) => {
    // 客户端IP验证（兼容IPv4/IPv6）
    const remoteAddress = clientSocket.remoteAddress.replace(/^::ffff:/, '');
    if (!CONFIG.ALLOWED_IPS.has(remoteAddress)) {
        console.warn(`[SECURITY] 非法访问尝试来自 ${remoteAddress}`);
        clientSocket.destroy();
        return;
    }

    // 连接目标服务器
    const connectTarget = (ip, port) => {
        const remoteSocket = net.connect(port, ip, () => {
            clientSocket.write(RESPONSE.SUCCESS);
            clientSocket.pipe(remoteSocket).pipe(clientSocket); // 双向数据转发
        });

        remoteSocket.on('error', () => clientSocket.end(RESPONSE.CONNECT_REFUSED));
    };

    // 协议握手处理
    clientSocket.once('data', data => {
        // 校验协议版本
        if (data[0] !== CONFIG.PROTOCOL_VERSION) {
            clientSocket.end();
            return;
        }

        // 认证方式协商（仅支持无认证）
        clientSocket.write(Buffer.from([0x05, 0x00]));

        // 请求处理
        clientSocket.once('data', req => {
            // 命令类型校验（仅支持CONNECT）
            if (req[0] !== 0x05 || req[1] !== 0x01) {
                clientSocket.end(RESPONSE.AUTH_FAIL);
                return;
            }

            // 地址类型解析
            const [atyp, offset] = [req[3], 4];
            try {
                let addr, port;
                switch (atyp) {
                    case 0x01: // IPv4
                        addr = req.slice(offset, offset + 4).join('.');
                        port = req.readUInt16BE(offset + 4);
                        break;
                    case 0x03: // 域名
                        const len = req[offset];
                        addr = req.slice(offset + 1, offset + 1 + len).toString();
                        port = req.readUInt16BE(offset + 1 + len);
                        dns.lookup(addr, (err, ip) => {
                            err ? clientSocket.end(RESPONSE.HOST_UNREACHABLE) : connectTarget(ip, port);
                        });
                        return;
                    case 0x04: // IPv6
                        addr = req.slice(offset, offset + 16);
                        port = req.readUInt16BE(offset + 16);
                        break;
                    default:
                        throw new Error('Unsupported address type');
                }
                connectTarget(addr, port);
            } catch (e) {
                clientSocket.end(RESPONSE.HOST_UNREACHABLE);
            }
        });
    });
});

server.listen(CONFIG.PORT, () => {
    console.log(`SOCKS5代理已启动，监听端口：${CONFIG.PORT}\n允许访问IP：${[...CONFIG.ALLOWED_IPS].join(', ')}`);
});