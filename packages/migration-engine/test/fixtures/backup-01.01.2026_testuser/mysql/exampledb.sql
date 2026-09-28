-- MySQL dump for exampledb
CREATE TABLE `posts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);

INSERT INTO `posts` VALUES (1, 'Hello world');

GRANT ALL PRIVILEGES ON `exampledb`.* TO 'testuser_dbuser'@'localhost';
