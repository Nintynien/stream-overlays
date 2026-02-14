import { BaseOverlay } from '../core/base-overlay.js';

/**
 * Reactive overlay - triggers various effects based on chat messages
 */
export class ReactiveOverlay extends BaseOverlay {
  constructor(config) {
    super(config);
    this.settings = {
      ...config.settings
    };

    // Cooldown tracking (in milliseconds)
    this.cooldowns = {
      confetti: { duration: 15000, lastTrigger: 0 },
      fireworks: { duration: 120000, lastTrigger: 0 },
      snow: { duration: 10000, lastTrigger: 0 },
      freeze: { duration: 300000, lastTrigger: 0 }
    };
  }

  onInit() {
    console.log('Reactive overlay initialized');
  }

  onMessage(message) {
    const text = message.message.toLowerCase();
    const now = Date.now();

    // Confetti Rain - triggers on 'congrats' and similar
    if (this.matchesWords(text, ['congrats', 'congratulations', 'gz', 'grats'])) {
      if (this.checkCooldown('confetti', now)) {
        this.triggerConfetti();
        this.cooldowns.confetti.lastTrigger = now;
      }
    }

    // Rising Balloons - triggers on 'happy birthday'
    if (this.matchesWords(text, ['happy birthday', 'hbd'])) {
      this.triggerBalloons();
    }

    // Firework Show - triggers on 'fireworks'
    if (this.matchesWords(text, ['fireworks', 'firework'])) {
      if (this.checkCooldown('fireworks', now)) {
        this.triggerFireworks();
        this.cooldowns.fireworks.lastTrigger = now;
      }
    }

    // Bomb - triggers on '!bomb' from moderator
    if (text.includes('!bomb') && message.moderator) {
      this.triggerBomb();
    }

    // Snowfall - triggers on 'snow'
    if (this.matchesWords(text, ['snow', 'snowing'])) {
      if (this.checkCooldown('snow', now)) {
        this.triggerSnow();
        this.cooldowns.snow.lastTrigger = now;
      }
    }

    // Freeze - triggers on 'brrr', 'cold', etc
    if (this.matchesWords(text, ['brrr', 'brr', 'cold', 'freezing', 'frozen'])) {
      if (this.checkCooldown('freeze', now)) {
        this.triggerFreeze();
        this.cooldowns.freeze.lastTrigger = now;
      }
    }
  }

  matchesWords(text, words) {
    return words.some(word => text.includes(word));
  }

  checkCooldown(effectName, now) {
    const cooldown = this.cooldowns[effectName];
    return now - cooldown.lastTrigger >= cooldown.duration;
  }

  // Effect implementations
  triggerConfetti() {
    console.log('[Reactive] Triggering confetti');
    const count = 50;

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = `${Math.random() * 100}%`;
        confetti.style.backgroundColor = this.randomColor();
        confetti.style.animationDelay = `${Math.random() * 0.5}s`;
        confetti.style.animationDuration = `${2 + Math.random() * 2}s`;

        this.container.appendChild(confetti);

        // Remove after animation + settle time
        setTimeout(() => confetti.remove(), 7000);
      }, i * 50); // Stagger creation
    }
  }

  triggerBalloons() {
    console.log('[Reactive] Triggering balloons');
    const colors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8B94'];
    const count = 5 + Math.floor(Math.random() * 5); // 5-9 balloons

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const balloon = document.createElement('div');
        balloon.className = 'balloon';
        balloon.style.left = `${10 + Math.random() * 80}%`;
        balloon.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        balloon.style.animationDuration = `${6 + Math.random() * 3}s`;
        balloon.style.animationDelay = `${Math.random() * 0.5}s`;

        this.container.appendChild(balloon);

        setTimeout(() => balloon.remove(), 10000);
      }, i * 200);
    }
  }

  triggerFireworks() {
    console.log('[Reactive] Triggering fireworks');
    const count = 8;

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const firework = document.createElement('div');
        firework.className = 'firework';
        firework.style.left = `${20 + Math.random() * 60}%`;
        firework.style.top = `${20 + Math.random() * 40}%`;

        // Create burst particles
        for (let j = 0; j < 30; j++) {
          const particle = document.createElement('div');
          particle.className = 'firework-particle';
          const angle = (j / 30) * Math.PI * 2;
          const distance = 50 + Math.random() * 50;
          particle.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
          particle.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);
          particle.style.backgroundColor = this.randomColor();
          firework.appendChild(particle);
        }

        this.container.appendChild(firework);

        setTimeout(() => firework.remove(), 2000);
      }, i * 400);
    }
  }

  triggerBomb() {
    console.log('[Reactive] Triggering bomb');

    const bomb = document.createElement('div');
    bomb.className = 'bomb';
    bomb.style.left = `${Math.random() * 80 + 10}%`;
    bomb.style.top = '-100px';

    // Fuse
    const fuse = document.createElement('div');
    fuse.className = 'bomb-fuse';
    bomb.appendChild(fuse);

    // Body
    const body = document.createElement('div');
    body.className = 'bomb-body';
    bomb.appendChild(body);

    this.container.appendChild(bomb);

    // Drop and roll
    setTimeout(() => {
      bomb.style.top = '60%';
      bomb.style.transform = 'rotate(720deg)';
    }, 10);

    // Explode after 3 seconds
    setTimeout(() => {
      bomb.classList.add('exploding');

      // Create explosion particles
      for (let i = 0; i < 40; i++) {
        const particle = document.createElement('div');
        particle.className = 'explosion-particle';
        const angle = (i / 40) * Math.PI * 2;
        const distance = 100 + Math.random() * 100;
        particle.style.left = '50%';
        particle.style.top = '50%';
        particle.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);
        particle.style.backgroundColor = ['#FF6B00', '#FF0000', '#FFD700', '#FF4500'][Math.floor(Math.random() * 4)];
        bomb.appendChild(particle);
      }

      setTimeout(() => bomb.remove(), 1500);
    }, 3000);
  }

  triggerSnow() {
    console.log('[Reactive] Triggering snow');
    const count = 30;
    const duration = 8000; // Snow falls for 8 seconds

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = '❄';
        snowflake.style.left = `${Math.random() * 100}%`;
        snowflake.style.fontSize = `${10 + Math.random() * 20}px`;
        snowflake.style.animationDuration = `${4 + Math.random() * 4}s`;
        snowflake.style.animationDelay = `${Math.random() * 2}s`;

        this.container.appendChild(snowflake);

        setTimeout(() => snowflake.remove(), duration);
      }, i * 50);
    }
  }

  triggerFreeze() {
    console.log('[Reactive] Triggering freeze');

    const freeze = document.createElement('div');
    freeze.className = 'freeze-overlay';

    // Add scattered ice crystals around the edges
    const crystalPositions = [
      { left: '5%', top: '10%' },
      { left: '15%', top: '5%' },
      { right: '8%', top: '12%' },
      { right: '18%', top: '6%' },
      { left: '10%', bottom: '8%' },
      { left: '20%', bottom: '15%' },
      { right: '12%', bottom: '10%' },
      { right: '5%', bottom: '18%' },
      { left: '50%', top: '3%' },
      { left: '50%', bottom: '3%' }
    ];

    crystalPositions.forEach((pos, index) => {
      const crystal = document.createElement('div');
      crystal.className = 'ice-crystal';
      crystal.textContent = '❄';
      Object.assign(crystal.style, pos);
      crystal.style.animationDelay = `${index * 0.2}s`;
      freeze.appendChild(crystal);
    });

    this.container.appendChild(freeze);

    // Remove after 5 seconds
    setTimeout(() => {
      freeze.classList.add('fade-out');
      setTimeout(() => freeze.remove(), 1000);
    }, 5000);
  }

  randomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
                    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52D3AA'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
