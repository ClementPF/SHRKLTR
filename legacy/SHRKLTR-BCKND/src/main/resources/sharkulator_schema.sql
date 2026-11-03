-- MySQL dump 10.13  Distrib 5.7.10, for osx10.11 (x86_64)
--
-- Host: localhost    Database: sharkulator
-- ------------------------------------------------------
-- Server version	5.7.10

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `game`
--

DROP TABLE IF EXISTS `game`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `game` (
  `game_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `date` datetime DEFAULT NULL,
  `tournament_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`game_id`),
  KEY `FK2xfdbv4n193efuyajlqh0vs6j` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outcome`
--

DROP TABLE IF EXISTS `outcome`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `outcome` (
  `outcome_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `result` int(11) NOT NULL,
  `score_value` double NOT NULL,
  `game_id` bigint(20) DEFAULT NULL,
  `user_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`outcome_id`),
  KEY `FKlvom3r4k5ahhb08idp9yb07ak` (`game_id`),
  KEY `FK4essrj1bn8n67umur73r4pcnl` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sport`
--

DROP TABLE IF EXISTS `sport`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sport` (
  `sport_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`sport_id`),
  UNIQUE KEY `UK_63em0e8bcxm3pqjooy08wquan` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stats`
--

DROP TABLE IF EXISTS `stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stats` (
  `stats_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `best_score` double NOT NULL,
  `game_count` int(11) NOT NULL,
  `longuest_lose_streak` int(11) NOT NULL,
  `longuest_tie_streak` int(11) NOT NULL,
  `longuest_win_streak` int(11) NOT NULL,
  `lose_count` int(11) NOT NULL,
  `lose_streak` int(11) NOT NULL,
  `score` double NOT NULL,
  `tie_count` int(11) NOT NULL,
  `tie_streak` int(11) NOT NULL,
  `win_count` int(11) NOT NULL,
  `win_streak` int(11) NOT NULL,
  `worst_score` double NOT NULL,
  `tournament_id` bigint(20) DEFAULT NULL,
  `user_id` bigint(20) NOT NULL,
  PRIMARY KEY (`stats_id`),
  KEY `FKe2l7af89tmdcrtci6wpcxa833` (`tournament_id`),
  KEY `FK1iu67ious6vd1bpvdl2atmifc` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament`
--

DROP TABLE IF EXISTS `tournament`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tournament` (
  `tournament_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `display_name` varchar(255) NOT NULL,
  `is_over` bit(1) NOT NULL,
  `name` varchar(255) NOT NULL,
  `user_id` bigint(20) DEFAULT NULL,
  `sport_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`tournament_id`),
  UNIQUE KEY `UKhswi99dqfqk68pblbp3xorngk` (`name`),
  KEY `FK9vgtiitd0tgfnr4e6ycv9wp92` (`user_id`),
  KEY `FKcd9y3gisxdycg7kp7pe6tfo1b` (`sport_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user`
--

DROP TABLE IF EXISTS `user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user` (
  `user_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) DEFAULT NULL,
  `first_name` varchar(255) DEFAULT NULL,
  `last_name` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `user_name` varchar(255) NOT NULL,
  `external_id_provider` varchar(255) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT 1,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `UK_lqjrcobrh9jc8wpcar64q1bfh` (`user_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

DROP TABLE IF EXISTS `role`;
CREATE TABLE `role` (
  `role_id` int NOT NULL AUTO_INCREMENT,
  `role` varchar(50) NOT NULL,
  PRIMARY KEY (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

DROP TABLE IF EXISTS `user_roles`;
CREATE TABLE `user_roles` (
  `user_id` bigint(20) NOT NULL,
  `role_id` int NOT NULL,
  PRIMARY KEY (`user_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2017-08-02 17:05:06
