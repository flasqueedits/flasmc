module.exports = {
  apps: [{
    name: 'flasmc',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      PORT: 3000,
      HOST: '0.0.0.0',
      NODE_ENV: 'production'
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    shutdown_with_message: true
  }]
};
